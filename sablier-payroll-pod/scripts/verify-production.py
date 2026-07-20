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
BUILD_INFO_DIR = ROOT / "artifacts" / "build-info"


def list_build_infos() -> list[Path]:
    if not BUILD_INFO_DIR.is_dir():
        raise SystemExit(f"Missing build-info dir {BUILD_INFO_DIR}; run npm run compile first")
    candidates = sorted(
        BUILD_INFO_DIR.glob("solc-0_8_28*.json"),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    return [p for p in candidates if not p.name.endswith(".output.json")]


def resolve_build_info(*, source_suffix: str, evm_version: str | None = None) -> Path:
    """Pick a solc-0.8.28 build-info whose sources include source_suffix (and optional evm)."""
    preferred = (
        BUILD_INFO_DIR / "solc-0_8_28-f944b1c4b16a38e3db13314e4d86f1b7f3dbc3ce.json"
    )
    candidates = list_build_infos()
    if preferred.exists() and preferred in candidates:
        candidates = [preferred] + [p for p in candidates if p != preferred]
    for path in candidates:
        bi = json.loads(path.read_text())
        sources = (bi.get("input") or {}).get("sources") or {}
        if not any(k.endswith(source_suffix) for k in sources):
            continue
        if evm_version is not None:
            got = ((bi.get("input") or {}).get("settings") or {}).get("evmVersion")
            if got != evm_version:
                continue
        return path
    raise SystemExit(
        f"No solc-0_8_28 build-info containing {source_suffix}"
        + (f" with evmVersion={evm_version}" if evm_version else "")
        + f" under {BUILD_INFO_DIR}"
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


def is_cotiscan_verified(address: str) -> bool:
    qs = urllib.parse.urlencode(
        {"module": "contract", "action": "getsourcecode", "address": address}
    )
    with urllib.request.urlopen(f"https://testnet.cotiscan.io/api?{qs}", timeout=60) as r:
        src = (json.load(r).get("result") or [{}])[0]
    return bool(src.get("SourceCode"))


def load_standard_json(build_info_path: Path) -> dict:
    bi = json.loads(build_info_path.read_text())
    if bi.get("solcLongVersion") == "0.8.28":
        bi["solcLongVersion"] = "0.8.28+commit.7893614a"
        build_info_path.write_text(json.dumps(bi))
    return bi["input"]


def contract_name(std: dict, rel: str) -> str:
    """rel like 'avax/PayrollVault.sol:PayrollVault'."""
    modern = f"project/contracts/sablier-payroll-pod/{rel}"
    legacy = f"project/contracts/pod-payroll-port/{rel}"
    sources = std.get("sources") or {}
    file_part = rel.split(":")[0]
    for key in sources:
        if key.endswith(file_part) or key.endswith("/" + file_part.split("/")[-1]):
            return f"{key}:{rel.split(':')[1]}"
    return modern if any("sablier-payroll-pod" in k for k in sources) else legacy


def poll_guids(
    guids: list[tuple[str, str]],
    *,
    check,
) -> None:
    for _ in range(30):
        if not guids:
            return
        time.sleep(5)
        remaining = []
        for name, guid in guids:
            st = check(guid)
            result = str(st.get("result", ""))
            print(f"  {name}: {result}")
            if "Pending" in result:
                remaining.append((name, guid))
        guids[:] = remaining


def main() -> None:
    if NETWORK not in CHAIN_IDS:
        raise SystemExit(f"Unsupported VERIFY_NETWORK={NETWORK}; use sepolia or avalancheFuji")
    chain_id = CHAIN_IDS[NETWORK]
    deploy_path = resolve_deploy()
    env = load_env()
    api_key = env["ETHERSCAN_API_KEY"]
    d = json.loads(deploy_path.read_text())

    # Fuji/Sepolia artifacts are cancun; COTI PrivatePayrollCoti is paris.
    build_info_path = resolve_build_info(
        source_suffix="PayrollVault.sol", evm_version="cancun"
    )
    print(f"Using AVAX build-info: {build_info_path.name}")
    std = load_standard_json(build_info_path)

    # Comptroller may live in an older/separate build-info than the vault compile.
    comptroller_bi = resolve_build_info(source_suffix="MockSablierComptroller.sol")
    comptroller_std = (
        load_standard_json(comptroller_bi)
        if comptroller_bi != build_info_path
        else std
    )
    if comptroller_bi != build_info_path:
        print(f"Using comptroller build-info: {comptroller_bi.name}")

    contracts = [
        (
            "PayrollVault",
            contract_name(std, "avax/PayrollVault.sol:PayrollVault"),
            d["payrollVault"],
            (
                "000000000000000000000000"
                + d["inboxSource"][2:].lower()
                + "000000000000000000000000"
                + d["privatePayrollCoti"][2:].lower()
            ),
            std,
        ),
        (
            "PodClaimStore",
            contract_name(std, "avax/PodClaimStore.sol:PodClaimStore"),
            d["payrollClaimStore"],
            "",
            std,
        ),
        (
            "MockSablierComptroller",
            contract_name(
                comptroller_std, "mocks/MockSablierComptroller.sol:MockSablierComptroller"
            ),
            d["comptroller"],
            "0" * 64,
            comptroller_std,
        ),
        (
            "PayrollCampaignFactory",
            contract_name(std, "avax/PayrollCampaignFactory.sol:PayrollCampaignFactory"),
            d["payrollCampaignFactory"],
            (
                "000000000000000000000000"
                + d["payrollVault"][2:].lower()
                + "000000000000000000000000"
                + d["payrollClaimStore"][2:].lower()
                + "000000000000000000000000"
                + d["comptroller"][2:].lower()
            ),
            std,
        ),
        (
            "PayrollCampaignFacade",
            contract_name(std, "avax/PayrollCampaignFacade.sol:PayrollCampaignFacade"),
            d["payrollCampaignFacade"],
            encode_facade_ctor(d),
            std,
        ),
    ]

    label = "Sepolia (Etherscan)" if NETWORK == "sepolia" else "Avalanche Fuji (Snowscan via Etherscan V2)"
    print(f"=== {label}  [{deploy_path.name}] ===")
    guids: list[tuple[str, str]] = []
    for name, cname, addr, ctor, source_std in contracts:
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
                "sourceCode": json.dumps(source_std),
                "codeformat": "solidity-standard-json-input",
                "contractname": cname,
                "compilerversion": "v0.8.28+commit.7893614a",
                "constructorArguments": ctor,
                "apikey": api_key,
            },
        )
        print(f"{name}: submit {resp}")
        if resp.get("status") == "1":
            guids.append((name, resp["result"]))
        time.sleep(1.2)

    poll_guids(
        guids,
        check=lambda guid: etherscan_check(api_key, chain_id, guid),
    )

    print("\n=== COTI (Cotiscan) PrivatePayrollCoti ===")
    coti = d["privatePayrollCoti"]
    if is_cotiscan_verified(coti):
        print("PrivatePayrollCoti: already verified")
    else:
        coti_bi = resolve_build_info(
            source_suffix="coti/PrivatePayrollCoti.sol", evm_version="paris"
        )
        print(f"Using COTI build-info: {coti_bi.name}")
        coti_std = load_standard_json(coti_bi)
        coti_cname = contract_name(coti_std, "coti/PrivatePayrollCoti.sol:PrivatePayrollCoti")
        ctor = (
            "000000000000000000000000"
            + d["inboxCoti"][2:].lower()
            + "000000000000000000000000"
            + d["cotiOwner"][2:].lower()
        )
        form = {
            "module": "contract",
            "action": "verifysourcecode",
            "contractaddress": coti,
            "sourceCode": json.dumps(coti_std),
            "codeformat": "solidity-standard-json-input",
            "contractname": coti_cname,
            "compilerversion": "v0.8.28+commit.7893614a",
            "constructorArguments": ctor,
        }
        data = urllib.parse.urlencode(form).encode()
        req = urllib.request.Request(
            "https://testnet.cotiscan.io/api", data=data, method="POST"
        )
        with urllib.request.urlopen(req, timeout=180) as r:
            resp = json.load(r)
        print(f"PrivatePayrollCoti: submit {resp}")
        if resp.get("status") == "1":
            coti_guids = [("PrivatePayrollCoti", resp["result"])]

            def coti_check(guid: str) -> dict:
                qs = urllib.parse.urlencode(
                    {
                        "module": "contract",
                        "action": "checkverifystatus",
                        "guid": guid,
                    }
                )
                with urllib.request.urlopen(
                    f"https://testnet.cotiscan.io/api?{qs}", timeout=60
                ) as r:
                    return json.load(r)

            poll_guids(coti_guids, check=coti_check)

    base = EXPLORER[NETWORK]
    print("\nExplorer links:")
    print(f"  {base}/address/{d['payrollVault']}#code")
    print(f"  {base}/address/{d['payrollClaimStore']}#code")
    if d.get("payrollCampaignFactory"):
        print(f"  {base}/address/{d['payrollCampaignFactory']}#code")
    print(f"  {base}/address/{d['payrollCampaignFacade']}#code")
    print(f"  {base}/address/{d['comptroller']}#code")
    print(f"  https://testnet.cotiscan.io/address/{d['privatePayrollCoti']}#code")


if __name__ == "__main__":
    main()
