#!/usr/bin/env python3
from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Iterable

import numpy as np
import openpyxl
import pandas as pd

try:
    from scipy.io import savemat
except ImportError:  # pragma: no cover
    savemat = None

import build_scored_seat_recommendation_dataset as scored_builder
import build_table_group_scene_annotations as annotation_builder


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
DESKTOP_DIR = ROOT.parent

SCORED_WORKBOOK_PATH = DATA_DIR / "座位推荐评分数据集.xlsx"

CORE_FEATURE_COLUMNS = [
    "单桌容量",
    "靠窗比例",
    "插座比例",
    "安静比例",
    "通道比例",
    "卫生间临近比例",
    "茶水间临近比例",
    "空调临近比例",
    "书架临近比例",
    "日照比例",
    "是否北侧区域",
    "是否南侧外圈",
]

CORE_FEATURE_REMARKS = {
    "单桌容量": "保留。区分4人桌和8人桌，对协作/设备/舒适都有影响。",
    "座位数": "删除。它与单桌容量在当前数据里完全一致，属于重复信息。",
    "靠窗比例": "保留。对应采光与舒适感。",
    "插座比例": "保留。对应设备学习与短时作业需求。",
    "安静比例": "保留。对应专注与舒适两类学习场景。",
    "通道比例": "保留。对应干扰程度和协作便利性。",
    "卫生间临近比例": "保留。对应环境干扰和短时停留便利性。",
    "茶水间临近比例": "保留。对应服务点便利与环境扰动。",
    "空调临近比例": "保留。推荐端要用，分类端也保留它。",
    "书架临近比例": "保留。和沉浸阅读、自习便利性相关。",
    "日照比例": "保留。和舒适久学型强相关。",
    "是否北侧区域": "保留。北侧安静属性明显，但只保留一个代表性区位特征，避免位置泄漏过强。",
    "是否西侧区域": "删除。完整总表中保留，但不进入核心特征版，避免分类过于依赖精确位置。",
    "是否东侧区域": "删除。完整总表中保留，但不进入核心特征版，避免分类过于依赖精确位置。",
    "是否南侧内圈": "删除。完整总表中保留，但不进入核心特征版，避免区位标签过强。",
    "是否南侧外圈": "保留。它和开放协作/设备作业场景确实有明显业务意义。",
}

SCORE_COLUMN_MAP = {
    "深度专注型": "专注基础分",
    "舒适久学型": "舒适基础分",
    "设备作业型": "设备基础分",
    "开放协作型": "协作基础分",
}

MULTILABEL_DELTA = 0.45


def autosize_workbook(path: Path) -> None:
    workbook = openpyxl.load_workbook(path)
    for sheet in workbook.worksheets:
        for column_cells in sheet.columns:
            max_length = 0
            column_letter = column_cells[0].column_letter
            for cell in column_cells:
                value = "" if cell.value is None else str(cell.value)
                max_length = max(max_length, len(value))
            sheet.column_dimensions[column_letter].width = min(max_length + 2, 40)
    workbook.save(path)


def build_output_paths() -> dict[str, Path]:
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    output_dir = DESKTOP_DIR / f"桌组分类与座位推荐一体化数据集_{timestamp}"
    output_dir.mkdir(parents=True, exist_ok=False)
    return {
        "output_dir": output_dir,
        "bundle_workbook": output_dir / "桌组分类与座位推荐一体化数据集.xlsx",
        "feature_workbook": output_dir / "桌组核心特征.xlsx",
        "multilabel_workbook": output_dir / "桌组多标签独热编码.xlsx",
        "singlelabel_workbook": output_dir / "桌组单标签索引.xlsx",
        "index_workbook": output_dir / "桌组样本索引.xlsx",
        "mat_file": output_dir / "桌组分类数据.mat",
        "readme_file": output_dir / "数据集使用说明.txt",
    }


def rebuild_upstream_sources() -> None:
    annotation_builder.main()
    scored_builder.main()


def load_scored_workbook() -> tuple[pd.DataFrame, pd.DataFrame]:
    if not SCORED_WORKBOOK_PATH.exists():
        raise FileNotFoundError(f"Missing scored workbook: {SCORED_WORKBOOK_PATH}")
    group_df = pd.read_excel(SCORED_WORKBOOK_PATH, sheet_name="桌组训练数据")
    seat_df = pd.read_excel(SCORED_WORKBOOK_PATH, sheet_name="座位推荐数据")
    return group_df, seat_df


def build_core_feature_df(group_df: pd.DataFrame) -> pd.DataFrame:
    feature_df = group_df[["桌组编号", "区域编码", *CORE_FEATURE_COLUMNS]].copy()
    return feature_df


def build_multilabel_df(group_df: pd.DataFrame) -> pd.DataFrame:
    score_frame = group_df[list(SCORE_COLUMN_MAP.values())].astype(float)
    max_scores = score_frame.max(axis=1)
    label_matrix = pd.DataFrame(
        {
            label: (score_frame[column] >= (max_scores - MULTILABEL_DELTA)).astype(int)
            for label, column in SCORE_COLUMN_MAP.items()
        }
    )
    multilabel_df = pd.concat(
        [
            group_df[["桌组编号", "区域编码", "最终场景标签", "次优场景标签", "标签置信度"]].reset_index(drop=True),
            label_matrix.reset_index(drop=True),
        ],
        axis=1,
    )
    multilabel_df["激活标签数"] = label_matrix.sum(axis=1)
    return multilabel_df


def build_singlelabel_df(group_df: pd.DataFrame) -> pd.DataFrame:
    return group_df[["桌组编号", "区域编码", "最终场景标签", "次优场景标签", "主次分差", "标签置信度"]].copy()


def build_index_df(group_df: pd.DataFrame) -> pd.DataFrame:
    return group_df[
        [
            "桌组编号",
            "区域编码",
            "区域名称",
            "区域方向",
            "单桌容量",
            "最终场景标签",
            "次优场景标签",
            "主次分差",
            "标签置信度",
            "标签说明",
        ]
    ].copy()


def build_field_guide_df() -> pd.DataFrame:
    rows = [
        {
            "工作表": "桌组训练数据",
            "字段": "桌组编号",
            "作用": "桌组级样本唯一标识，后续可以映射回座位推荐端。",
            "是否进入核心特征版": "否",
        },
        {
            "工作表": "桌组训练数据",
            "字段": "区域编码 / 区域名称 / 区域方向",
            "作用": "描述桌组位于图书馆哪个大区，便于解释，不建议直接全部丢进核心模型。",
            "是否进入核心特征版": "否",
        },
        {
            "工作表": "桌组训练数据",
            "字段": "单桌容量",
            "作用": "区分4人桌和8人桌，是协作与设备场景的重要基础特征。",
            "是否进入核心特征版": "是",
        },
        {
            "工作表": "桌组训练数据",
            "字段": "靠窗比例 / 日照比例",
            "作用": "反映采光与舒适性，适合长时间阅读和久坐学习。",
            "是否进入核心特征版": "是",
        },
        {
            "工作表": "桌组训练数据",
            "字段": "插座比例",
            "作用": "反映设备学习便利性，比如电脑、自习灯和充电需求。",
            "是否进入核心特征版": "是",
        },
        {
            "工作表": "桌组训练数据",
            "字段": "安静比例 / 通道比例",
            "作用": "共同反映沉浸学习与协作交流的环境差异。",
            "是否进入核心特征版": "是",
        },
        {
            "工作表": "桌组训练数据",
            "字段": "卫生间临近比例 / 茶水间临近比例 / 空调临近比例 / 书架临近比例",
            "作用": "这些是你小程序推荐端已经用到的环境属性，这次完整保留。",
            "是否进入核心特征版": "是",
        },
        {
            "工作表": "桌组训练数据",
            "字段": "是否北侧区域 / 是否南侧外圈",
            "作用": "作为最有代表性的两项区位特征进入核心特征版，保留方向信息但不过度泄漏精确位置。",
            "是否进入核心特征版": "是",
        },
        {
            "工作表": "桌组训练数据",
            "字段": "是否西侧区域 / 是否东侧区域 / 是否南侧内圈",
            "作用": "仍保留在完整总表中，后续可做消融实验，但默认不放入核心特征版。",
            "是否进入核心特征版": "否",
        },
        {
            "工作表": "桌组训练数据",
            "字段": "专注基础分 / 舒适基础分 / 设备基础分 / 协作基础分",
            "作用": "四个基础分用来描述一个桌组对四类学习需求的适配程度。",
            "是否进入核心特征版": "否",
        },
        {
            "工作表": "桌组多标签",
            "字段": "四个独热标签列",
            "作用": "按照‘最高分附近0.45分以内也算有效标签’导出，方便做多标签实验。",
            "是否进入核心特征版": "标签文件",
        },
        {
            "工作表": "座位推荐数据",
            "字段": "是否靠近空调 / 是否靠窗 / 是否有插座 / 是否靠近通道等",
            "作用": "这些列直接服务于你的小程序推荐逻辑，所以全部保留。",
            "是否进入核心特征版": "用于推荐，不直接进入桌组核心特征版",
        },
    ]
    return pd.DataFrame(rows)


def build_feature_selection_df(group_df: pd.DataFrame, core_feature_df: pd.DataFrame) -> pd.DataFrame:
    rows = []
    all_candidates = [
        "单桌容量",
        "座位数",
        "靠窗比例",
        "插座比例",
        "安静比例",
        "通道比例",
        "卫生间临近比例",
        "茶水间临近比例",
        "空调临近比例",
        "书架临近比例",
        "日照比例",
        "是否北侧区域",
        "是否西侧区域",
        "是否东侧区域",
        "是否南侧内圈",
        "是否南侧外圈",
    ]
    for column in all_candidates:
        rows.append(
            {
                "字段": column,
                "是否进入核心特征版": "是" if column in CORE_FEATURE_COLUMNS else "否",
                "取舍原因": CORE_FEATURE_REMARKS[column],
            }
        )

    rows.append(
        {
            "字段": "核心特征数量",
            "是否进入核心特征版": "结果说明",
            "取舍原因": f"最终保留 {len(CORE_FEATURE_COLUMNS)} 项核心特征，桌组样本数 {len(core_feature_df)} 条。",
        }
    )
    rows.append(
        {
            "字段": "主标签分布",
            "是否进入核心特征版": "结果说明",
            "取舍原因": " / ".join(
                f"{label}:{count}" for label, count in group_df["最终场景标签"].value_counts().to_dict().items()
            ),
        }
    )
    return pd.DataFrame(rows)


def build_readme_df(
    group_df: pd.DataFrame,
    seat_df: pd.DataFrame,
    multilabel_df: pd.DataFrame,
    output_dir: Path,
) -> pd.DataFrame:
    activated_counts = multilabel_df["激活标签数"].value_counts().sort_index().to_dict()
    rows = [
        ("输出目录", str(output_dir)),
        ("训练单位", "桌组级，一行代表一个桌组。"),
        ("推荐单位", "座位级，一行代表一个具体座位。"),
        ("最新源数据", str(DATA_DIR / "seat_master.json")),
        ("桌组样本数", str(len(group_df))),
        ("座位样本数", str(len(seat_df))),
        ("最终场景标签数", "4类：深度专注型、舒适久学型、设备作业型、开放协作型。"),
        ("多标签导出规则", f"若某维基础分距离最高分不超过 {MULTILABEL_DELTA:.2f}，则该维也记为1。"),
        ("多标签激活个数分布", " / ".join(f"{count}标签:{rows}" for count, rows in activated_counts.items())),
        ("核心特征数量", str(len(CORE_FEATURE_COLUMNS))),
        ("为什么不直接用全部位置特征", "完整总表仍保留所有推荐字段，但核心特征版故意减少过强的位置泄漏，让后续算法对比更自然。"),
        ("推荐端保留情况", "是否靠近空调、是否靠窗、是否有插座、是否靠近通道、桌组编号等字段都保留在完整总表和座位推荐表中。"),
        ("后续建议", "sklearn多算法对比优先使用‘桌组核心特征.xlsx’ + ‘桌组单标签索引.xlsx’；多标签实验使用‘桌组多标签独热编码.xlsx’。"),
    ]
    return pd.DataFrame(rows, columns=["项目", "说明"])


def export_bundle_workbook(
    group_df: pd.DataFrame,
    seat_df: pd.DataFrame,
    core_feature_df: pd.DataFrame,
    multilabel_df: pd.DataFrame,
    output_path: Path,
) -> None:
    with pd.ExcelWriter(output_path, engine="openpyxl") as writer:
        group_df.to_excel(writer, sheet_name="桌组训练数据", index=False)
        seat_df.to_excel(writer, sheet_name="座位推荐数据", index=False)
        core_feature_df.to_excel(writer, sheet_name="桌组核心特征", index=False)
        multilabel_df.to_excel(writer, sheet_name="桌组多标签", index=False)
        build_field_guide_df().to_excel(writer, sheet_name="字段说明", index=False)
        build_feature_selection_df(group_df, core_feature_df).to_excel(writer, sheet_name="特征取舍建议", index=False)
        build_readme_df(group_df, seat_df, multilabel_df, output_path.parent).to_excel(writer, sheet_name="生成说明", index=False)
    autosize_workbook(output_path)


def export_simple_workbook(df: pd.DataFrame, output_path: Path, sheet_name: str = "Sheet1") -> None:
    with pd.ExcelWriter(output_path, engine="openpyxl") as writer:
        df.to_excel(writer, sheet_name=sheet_name, index=False)
    autosize_workbook(output_path)


def export_mat_file(core_feature_df: pd.DataFrame, multilabel_df: pd.DataFrame, group_df: pd.DataFrame, output_path: Path) -> str:
    if savemat is None:
        return "当前环境未安装 scipy，已跳过 .mat 导出。"

    features_only = core_feature_df[CORE_FEATURE_COLUMNS].to_numpy(dtype=float)
    multilabel_only = multilabel_df[list(SCORE_COLUMN_MAP.keys())].to_numpy(dtype=np.int8)
    label_names = np.array(list(SCORE_COLUMN_MAP.keys()), dtype=object)
    feature_names = np.array(CORE_FEATURE_COLUMNS, dtype=object)
    group_ids = group_df["桌组编号"].astype(str).to_numpy(dtype=object)
    zone_codes = group_df["区域编码"].astype(str).to_numpy(dtype=object)
    final_labels = group_df["最终场景标签"].astype(str).to_numpy(dtype=object)

    savemat(
        output_path,
        {
            "features_core": features_only,
            "labels_multilabel": multilabel_only,
            "group_ids": group_ids,
            "zone_codes": zone_codes,
            "final_labels": final_labels,
            "feature_names": feature_names,
            "label_names": label_names,
        },
    )
    return "已导出 .mat 文件，可直接用于后续深度学习或 MATLAB/Scipy 读取。"


def write_text_summary(
    group_df: pd.DataFrame,
    seat_df: pd.DataFrame,
    multilabel_df: pd.DataFrame,
    output_path: Path,
    mat_export_note: str,
) -> None:
    label_counts = group_df["最终场景标签"].value_counts().to_dict()
    multilabel_counts = multilabel_df["激活标签数"].value_counts().sort_index().to_dict()
    lines = [
        "这套数据集的定位：桌组分类 + 座位推荐一体化。",
        "",
        "你后续如果要跑经典分类算法：",
        "优先使用《桌组核心特征.xlsx》作为 X，使用《桌组单标签索引.xlsx》中的最终场景标签作为 y。",
        "",
        "你后续如果要跑多标签/One-Hot 模型：",
        "使用《桌组核心特征.xlsx》作为 X，使用《桌组多标签独热编码.xlsx》作为 y。",
        "",
        "为什么这么设计：",
        "1. 桌组级更适合做论文里的分类对比，因为同一桌组内座位大环境高度相似。",
        "2. 座位级数据继续完整保留推荐字段，方便和你的小程序推荐逻辑对接。",
        "3. 核心特征版刻意删掉了一部分过强的位置泄漏字段，避免算法精度虚高得太夸张。",
        "",
        f"桌组样本数：{len(group_df)}",
        f"座位样本数：{len(seat_df)}",
        "最终主标签分布：" + " / ".join(f"{label}:{count}" for label, count in label_counts.items()),
        "多标签激活数分布：" + " / ".join(f"{count}标签:{rows}" for count, rows in multilabel_counts.items()),
        "",
        mat_export_note,
    ]
    output_path.write_text("\n".join(lines), encoding="utf-8")


def main() -> None:
    output_paths = build_output_paths()
    rebuild_upstream_sources()
    group_df, seat_df = load_scored_workbook()

    core_feature_df = build_core_feature_df(group_df)
    multilabel_df = build_multilabel_df(group_df)
    singlelabel_df = build_singlelabel_df(group_df)
    index_df = build_index_df(group_df)

    export_bundle_workbook(
        group_df=group_df,
        seat_df=seat_df,
        core_feature_df=core_feature_df,
        multilabel_df=multilabel_df,
        output_path=output_paths["bundle_workbook"],
    )
    export_simple_workbook(
        core_feature_df[CORE_FEATURE_COLUMNS],
        output_paths["feature_workbook"],
    )
    export_simple_workbook(
        multilabel_df[list(SCORE_COLUMN_MAP.keys())],
        output_paths["multilabel_workbook"],
    )
    export_simple_workbook(singlelabel_df, output_paths["singlelabel_workbook"])
    export_simple_workbook(index_df, output_paths["index_workbook"])

    mat_export_note = export_mat_file(
        core_feature_df=core_feature_df,
        multilabel_df=multilabel_df,
        group_df=group_df,
        output_path=output_paths["mat_file"],
    )
    write_text_summary(
        group_df=group_df,
        seat_df=seat_df,
        multilabel_df=multilabel_df,
        output_path=output_paths["readme_file"],
        mat_export_note=mat_export_note,
    )

    print(f"输出目录: {output_paths['output_dir']}")
    print(f"桌组样本数: {len(group_df)}")
    print(f"座位样本数: {len(seat_df)}")
    print("最终标签分布:")
    print(group_df["最终场景标签"].value_counts().to_string())
    print("")
    print("多标签激活个数分布:")
    print(multilabel_df["激活标签数"].value_counts().sort_index().to_string())
    print("")
    print("生成文件:")
    for key, path in output_paths.items():
        if key == "output_dir":
            continue
        print(f"  {path.name}")


if __name__ == "__main__":
    main()
