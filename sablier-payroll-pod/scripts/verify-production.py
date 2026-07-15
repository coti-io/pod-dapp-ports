#!/usr/bin/env python3
"""Verify deployed Sablier payroll contracts from deployments/production-payroll*.json."""
from __future__ import annotations

import json
import os
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PEI_ENV = ROOT.resolve().parents[1] / "pod-ecosystem-integration" / ".env"
NETWORK = os.environ.get("VERIFY_NETWORK", "sepolia").strip() or "sepolia"
DEPLOY_CANDIDATES = [
    ROOT / "deployments" / f"production-payroll-{NETWORK}.json",
    ROOT / "deployments" / "production-payroll.json",
]
BUILD_INFO = (
    ROOT
    / "artifacts"
    / "build-info"
    / "solc-0_8_28-f944b1c4b16a38e3db13314e4d86f1b7f3dbc3ce.json"
)

CHAIN_IDS = {
    "sepolia": 11155111,
    "avalancheFuji": 43113,
}
EXPLORER = {
    "sepolia": "https://sepolia.etherscan.io",
    "avalancheFuji": "https://testnet.snowscan.xyz",
}


def resolve_deploy() -> Path:
    for p in DEPLOY_CANDIDATES:
        if p.exists():
            return p
    raise SystemExit(f"Missing deployment manifest (tried {DEPLOY_CANDIDATES})")


def load_env() -> dict[str, str]:
    out: dict[str, str] = {}
    for line in PEI_ENV.read_text().splitlines():
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        out[k] = v.strip().strip('"')
    return out


def encode_facade_ctor(d: dict) -> str:
    def word_addr(a: str) -> str:
        return a.lower().replace("0x", "").rjust(64, "0")

    def word_int(n: int) -> str:
        return f"{n:064x}"

    admin = d["owner"]
    start = int(d.get("campaignStartTime") or 1784111113)
    name = (d.get("campaignName") or "PoD Payroll Production").encode()
    heads = [
        word_addr(admin),
        word_addr(d["comptroller"]),
        "00" * 32,
        word_addr(d["pToken"]),
        word_int(start),
        word_int(0),
        word_int(8 * 32),
        word_int(0),
    ]
    slen = word_int(len(name))
    spad = name + b"\x00" * ((32 - len(name) % 32) % 32)
    return "".join(heads) + slen + spad.hex()


def etherscan_post(api_key: str, chain_id: int, form: dict) -> dict:
    data = urllib.parse.urlencode(form).encode()
    req = urllib.request.Request(
        f"https://api.etherscan.io/v2/api?chainid={chain_id}", data=data, method="POST"
    )
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.load(r)


def etherscan_check(api_key: str, chain_id: int, guid: str) -> dict:
    qs = urllib.parse.urlencode(
        {
            "chainid": chain_id,
            "module": "contract",
            "action": "checkverifystatus",
            "guid": guid,
            "apikey": api_key,
        }
    )
    with urllib.request.urlopen(f"https://api.etherscan.io/v2/api?{qs}", timeout=60) as r:
        return json.load(r)


def is_etherscan_verified(api_key: str, chain_id: int, address: str) -> bool:
    qs = urllib.parse.urlencode(
        {
            "chainid": chain_id,
            "module": "contract",
            "action": "getsourcecode",
            "address": address,
            "apikey": api_key,
        }
    )
    with urllib.request.urlopen(f"https://api.etherscan.io/v2/api?{qs}", timeout=60) as r:
        data = json.load(r)
    src = (data.get("result") or [{}])[0]
    return bool(src.get("SourceCode"))


def main() -> None:
    if NETWORK not in CHAIN_IDS:
        raise SystemExit(f"Unsupported VERIFY_NETWORK={NETWORK}; use sepolia or avalancheFuji")
    chain_id = CHAIN_IDS[NETWORK]
    deploy_path = resolve_deploy()
    env = load_env()
    api_key = env["ETHERSCAN_API_KEY"]
    d = json.loads(deploy_path.read_text())
    bi = json.loads(BUILD_INFO.read_text())
    if bi.get("solcLongVersion") == "0.8.28":
        bi["solcLongVersion"] = "0.8.28+commit.7893614a"
        BUILD_INFO.write_text(json.dumps(bi))
    std = bi["input"]

    def cname(rel: str) -> str:
        modern = f"project/contracts/sablier-payroll-pod/{rel}"
        legacy = f"project/contracts/pod-payroll-port/{rel}"
        sources = std.get("sources") or {}
        file_part = rel.split(":")[0]
        for key in sources:
            if key.endswith(file_part) or key.endswith("/" + file_part.split("/")[-1]):
                return f"{key}:{rel.split(':')[1]}"
        return modern if any("sablier-payroll-pod" in k for k in sources) else legacy

    contracts = [
        (
            "PayrollVault",
            cname("avax/PayrollVault.sol:PayrollVault"),
            d["payrollVault"],
            (
                "000000000000000000000000"
                + d["inboxSource"][2:].lower()
                + "000000000000000000000000"
                + d["privatePayrollCoti"][2:].lower()
            ),
        ),
        (
            "PodClaimStore",
            cname("avax/PodClaimStore.sol:PodClaimStore"),
            d["payrollClaimStore"],
            "",
        ),
        (
            "MockSablierComptroller",
            cname("mocks/MockSablierComptroller.sol:MockSablierComptroller"),
            d["comptroller"],
            "0" * 64,
        ),
        (
            "PayrollCampaignFacade",
            cname("avax/PayrollCampaignFacade.sol:PayrollCampaignFacade"),
            d["payrollCampaignFacade"],
            encode_facade_ctor(d),
        ),
    ]

    label = "Sepolia (Etherscan)" if NETWORK == "sepolia" else "Avalanche Fuji (Snowscan via Etherscan V2)"
    print(f"=== {label}  [{deploy_path.name}] ===")
    guids: list[tuple[str, str]] = []
    for name, contract_name, addr, ctor in contracts:
        if is_etherscan_verified(api_key, chain_id, addr):
            print(f"{name}: already verified")
            continue
        resp = etherscan_post(
            api_key,
            chain_id,
            {
                "module": "contract",
                "action": "verifysourcecode",
                "contractaddress": addr,
                "sourceCode": json.dumps(std),
                "codeformat": "solidity-standard-json-input",
                "contractname": contract_name,
                "compilerversion": "v0.8.28+commit.7893614a",
                "constructorArguments": ctor,
                "apikey": api_key,
            },
        )
        print(f"{name}: submit {resp}")
        if resp.get("status") == "1":
            guids.append((name, resp["result"]))
        time.sleep(1.2)

    for _ in range(24):
        if not guids:
            break
        time.sleep(5)
        remaining = []
        for name, guid in guids:
            st = etherscan_check(api_key, chain_id, guid)
            result = str(st.get("result", ""))
            print(f"  {name}: {result}")
            if "Pending" in result:
                remaining.append((name, guid))
        guids = remaining

    print("\n=== COTI (Cotiscan) PrivatePayrollCoti ===")
    coti = d["privatePayrollCoti"]
    qs = urllib.parse.urlencode({"module": "contract", "action": "getsourcecode", "address": coti})
    with urllib.request.urlopen(f"https://testnet.cotiscan.io/api?{qs}", timeout=60) as r:
        src = (json.load(r).get("result") or [{}])[0]
    if src.get("SourceCode"):
        print("PrivatePayrollCoti: already verified")
    else:
        print(
            "PrivatePayrollCoti not verified yet — re-run with paris standard-json "
            "(see prior deploy session /tmp/payroll-coti-input.json)"
        )

    base = EXPLORER[NETWORK]
    print("\nExplorer links:")
    print(f"  {base}/address/{d['payrollVault']}#code")
    print(f"  {base}/address/{d['payrollClaimStore']}#code")
    print(f"  {base}/address/{d['payrollCampaignFacade']}#code")
    print(f"  {base}/address/{d['comptroller']}#code")
    print(f"  https://testnet.cotiscan.io/address/{d['privatePayrollCoti']}#code")


if __name__ == "__main__":
    main()
