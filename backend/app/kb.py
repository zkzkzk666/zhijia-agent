"""内置知识库：随项目发布的智驾领域参考文档，可一键导入到浏览器端知识库。"""

from pathlib import Path

KB_DIR = Path(__file__).resolve().parent.parent.parent / "knowledge_base"

DOC_TITLES = {
    "感知与传感器": "相机/激光雷达/毫米波/超声波、标定与时间同步、BEV/Occupancy、失效降级",
    "融合与定位": "多传感器融合、组合定位、GNSS/RTK/IMU、高精地图、SLAM、失效处理",
    "规划与控制": "行为决策、轨迹规划（Frenet/EM/MPC）、AEB/ACC/LKA、接管与降级、调参要点",
    "功能安全ISO26262": "功能安全生命周期、HARA、安全目标、ASIL、FMEA/FTA、工程落地",
    "SOTIF与ODD": "ISO 21448 预期功能安全、ODD 定义、触发条件分析、验收准则",
    "测试与数据": "测试金字塔、场景库设计、路测与数据闭环、数据脱敏、问题复现",
    "通信与架构": "CAN/以太网/SOME-IP/DDS、域控与 SOA、时间同步、诊断与 OTA",
    "法规与网络安全": "中国智驾准入与数据法规、ISO 21434 网络安全、合规落地清单",
}


def list_builtin_kb() -> list[dict]:
    """返回内置知识库文档列表（按文件名排序）。"""
    if not KB_DIR.is_dir():
        return []
    docs = []
    for path in sorted(KB_DIR.glob("*.md")):
        text = path.read_text(encoding="utf-8")
        docs.append({
            "name": path.name,
            "title": path.stem,
            "desc": DOC_TITLES.get(path.stem, ""),
            "text": text,
        })
    return docs
