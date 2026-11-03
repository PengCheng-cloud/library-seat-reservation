#!/usr/bin/env python3
from __future__ import annotations

import shutil
from datetime import datetime
from pathlib import Path

import numpy as np
import openpyxl
import pandas as pd
from scipy.io import savemat

import build_integrated_group_and_seat_dataset as integrated_builder


ROOT = Path(__file__).resolve().parents[1]
DESKTOP_DIR = ROOT.parent


def build_experiment_feature_df(group_df: pd.DataFrame) -> pd.DataFrame:
    seat_count = group_df["座位数"].astype(float)

    def ratio_to_count(column_name: str) -> pd.Series:
        return (seat_count * group_df[column_name].astype(float)).round().astype(int)

    letters = group_df["桌组编号"].astype(str).str.split("-").str[-1]
    rank_df = pd.DataFrame(
        {
            "桌组编号": group_df["桌组编号"].astype(str),
            "区域编码": group_df["区域编码"].astype(str),
            "桌组字母": letters,
        }
    ).sort_values(["区域编码", "桌组字母", "桌组编号"])
    rank_df["区域内桌组序号"] = rank_df.groupby("区域编码").cumcount() + 1
    rank_df["区域内桌组总数"] = rank_df.groupby("区域编码")["区域内桌组序号"].transform("max")
    rank_df["区域内桌组序位比例"] = np.where(
        rank_df["区域内桌组总数"] > 1,
        (rank_df["区域内桌组序号"] - 1) / (rank_df["区域内桌组总数"] - 1),
        0.0,
    )

    rank_ratio = (
        rank_df.set_index("桌组编号")
        .reindex(group_df["桌组编号"].astype(str))["区域内桌组序位比例"]
        .astype(float)
        .to_numpy()
    )

    return pd.DataFrame(
        {
            "单桌容量": group_df["单桌容量"].astype(float),
            "靠窗座位数": ratio_to_count("靠窗比例"),
            "有插座座位数": ratio_to_count("插座比例"),
            "安静座位数": ratio_to_count("安静比例"),
            "靠通道座位数": ratio_to_count("通道比例"),
            "靠卫生间座位数": ratio_to_count("卫生间临近比例"),
            "靠茶水间座位数": ratio_to_count("茶水间临近比例"),
            "靠空调座位数": ratio_to_count("空调临近比例"),
            "靠书架座位数": ratio_to_count("书架临近比例"),
            "有日照座位数": ratio_to_count("日照比例"),
            "区域内桌组序位比例": np.round(rank_ratio, 4),
            "是否北侧区域": group_df["是否北侧区域"].astype(int),
            "是否南侧外圈": group_df["是否南侧外圈"].astype(int),
        }
    )


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


def make_output_dir() -> Path:
    folder_name = f"桌组算法实验数据包_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
    output_dir = DESKTOP_DIR / folder_name
    output_dir.mkdir(parents=True, exist_ok=False)
    return output_dir


def export_excel(path: Path, df: pd.DataFrame, sheet_name: str = "Sheet1") -> None:
    with pd.ExcelWriter(path, engine="openpyxl") as writer:
        df.to_excel(writer, sheet_name=sheet_name, index=False)
    autosize_workbook(path)


def build_feature_design_df() -> pd.DataFrame:
    rows = [
        ("单桌容量", "保留4人桌/8人桌差异，是协作与设备场景的重要基础特征。"),
        ("靠窗座位数", "比靠窗比例更直观，能直接表示这个桌组里有多少个靠窗座位。"),
        ("有插座座位数", "原来插座比例大多只有0或1，现在改成计数后更自然。"),
        ("安静座位数", "原来安静比例大多只有0或1，现在改成计数后更自然。"),
        ("靠通道座位数", "表示这个桌组里多少个座位受通道影响。"),
        ("靠卫生间座位数", "表示这个桌组里多少个座位靠近卫生间。"),
        ("靠茶水间座位数", "表示这个桌组里多少个座位靠近茶水间。"),
        ("靠空调座位数", "表示这个桌组里多少个座位靠近空调。"),
        ("靠书架座位数", "表示这个桌组里多少个座位靠近书架。"),
        ("有日照座位数", "表示这个桌组里多少个座位有日照。"),
        ("区域内桌组序位比例", "桌组在本区域中的相对位置，用于补充更细的空间差异。"),
        ("是否北侧区域", "保留最有业务意义的区位特征之一。"),
        ("是否南侧外圈", "保留最有业务意义的区位特征之一。"),
    ]
    return pd.DataFrame(rows, columns=["特征字段", "设计原因"])


def build_reconstruction_rule_df() -> pd.DataFrame:
    rows = [
        ("靠近卫生间", "保持原始布局", "按原始平面位置保留，不做捏造。"),
        ("靠近茶水间", "保持原始布局", "同属建筑服务点，继续保留原始空间关系。"),
        ("靠近空调", "保持原始布局", "按原始平面位置保留，不做捏造。"),
        ("靠近通道", "保持原始布局", "按原始平面位置保留，不做捏造。"),
        ("靠窗", "保持原始布局", "继续保留原始外墙/窗边分布。"),
        ("插座", "空间约束重构", "按区域类型、桌型和组内微差异重构，不再整桌全0或全1。"),
        ("安静", "空间约束重构", "同时考虑区域、通道、服务点、空调和组内差异。"),
        ("日照", "空间约束重构", "以靠窗和区域朝向为主，再叠加少量空间微差异。"),
        ("书架邻近", "空间约束重构", "保留原始书架热点区域，同时改成更像真实场景的局部邻近。"),
    ]
    return pd.DataFrame(rows, columns=["字段", "处理方式", "说明"])


def export_dataset_workbook(
    path: Path,
    group_df: pd.DataFrame,
    seat_df: pd.DataFrame,
    feature_df: pd.DataFrame,
    label_df: pd.DataFrame,
    sample_index_df: pd.DataFrame,
) -> None:
    field_guide_df = integrated_builder.build_field_guide_df()
    feature_selection_df = build_feature_design_df()
    reconstruction_rule_df = build_reconstruction_rule_df()
    with pd.ExcelWriter(path, engine="openpyxl") as writer:
        group_df.to_excel(writer, sheet_name="桌组训练数据", index=False)
        seat_df.to_excel(writer, sheet_name="座位推荐数据", index=False)
        feature_df.to_excel(writer, sheet_name="特征矩阵", index=False)
        label_df.to_excel(writer, sheet_name="标签矩阵", index=False)
        sample_index_df.to_excel(writer, sheet_name="样本索引", index=False)
        field_guide_df.to_excel(writer, sheet_name="字段说明", index=False)
        feature_selection_df.to_excel(writer, sheet_name="特征取舍说明", index=False)
        reconstruction_rule_df.to_excel(writer, sheet_name="重构规则", index=False)
    autosize_workbook(path)


def export_mat(path: Path, feature_df: pd.DataFrame, label_df: pd.DataFrame) -> None:
    savemat(
        path,
        {
            "X": feature_df.to_numpy(dtype=np.float64),
            "Y": label_df.to_numpy(dtype=np.float64),
        },
    )


def write_mat_script(path: Path) -> None:
    script_text = """#!/usr/bin/env python3
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.io import savemat


BASE_DIR = Path(__file__).resolve().parent
FEATURES_PATH = BASE_DIR / "features.xlsx"
LABELS_PATH = BASE_DIR / "labels.xlsx"
OUTPUT_PATH = BASE_DIR / "output.mat"


def main() -> None:
    features_df = pd.read_excel(FEATURES_PATH)
    labels_df = pd.read_excel(LABELS_PATH)
    X = features_df.values.astype(np.float64)
    Y = labels_df.values.astype(np.float64)
    savemat(OUTPUT_PATH, {"X": X, "Y": Y})
    print(f"已生成: {OUTPUT_PATH}")
    print(f"X 形状: {X.shape}")
    print(f"Y 形状: {Y.shape}")


if __name__ == "__main__":
    main()
"""
    path.write_text(script_text, encoding="utf-8")


def write_readme(path: Path, feature_df: pd.DataFrame, label_df: pd.DataFrame, sample_index_df: pd.DataFrame) -> None:
    label_counts = label_df.sum().to_dict()
    active_label_counts = label_df.sum(axis=1).value_counts().sort_index().to_dict()
    lines = [
        "桌组算法实验数据包说明",
        "=" * 28,
        "",
        "本目录已经按你的要求重新整理：",
        "1. 只有 features.xlsx、labels.xlsx、output.mat 保留英文文件名。",
        "2. 其他文件名、数据列名、说明文字、实验图表标题全部使用中文。",
        "3. 分类特征不再把大量整组统一属性写成 0/1 比例，而是改成更自然的“座位数/计数”表达。",
        "4. 靠近卫生间/茶水间/空调/通道/靠窗继续保留原始布局，插座/安静/日照/书架邻近按空间约束做了重构。",
        "",
        f"桌组样本数：{len(feature_df)}",
        f"特征数：{feature_df.shape[1]}",
        f"标签数：{label_df.shape[1]}",
        "",
        "文件用途：",
        "- features.xlsx：分类算法输入特征矩阵。",
        "- labels.xlsx：多标签独热编码标签矩阵。",
        "- output.mat：给老师代码或 MATLAB / scipy 直接读取。",
        "- 样本索引.xlsx：方便把算法结果映射回桌组与区域。",
        "- 桌组分类与推荐综合数据集.xlsx：总览工作簿，含桌组表、座位表、字段说明。",
        "- run_mat_sklearn_classification_suite.py：批量跑 sklearn 经典算法对比，并在结果目录中为每个算法生成单独的 run_当前算法.py。",
        "- excel_to_mat.py：修改 features/labels 后重新生成 output.mat。",
        "",
        "特征设计说明：",
        "- 以桌组为分类样本，但不再把插座、安静、通道、空调等整组统一属性都写成 0/1 比例。",
        "- 现在改成“有多少个座位具备该属性”，例如有插座座位数、安静座位数、靠通道座位数。",
        "- 靠窗因为组内确实会变化，所以也统一写成靠窗座位数。",
        "- 另外补了“区域内桌组序位比例”，用于表示桌组在本区域中的相对位置，避免全靠粗粒度分区字段做分类。",
        "- 推荐端仍保留座位级字段，所以最后可以先判桌组，再下钻到具体座位做推荐。",
        "",
        "标签激活情况：",
    ]
    for active_count, sample_count in active_label_counts.items():
        lines.append(f"- {active_count} 个激活标签：{sample_count} 条样本")
    lines.extend(["", "各标签正样本数："])
    for label_name, count in label_counts.items():
        lines.append(f"- {label_name}：{int(count)}")
    lines.extend(
        [
            "",
            "样本索引字段说明：",
            "- 样本编号：当前数据包内的行号编号。",
            "- 桌组编号 / 区域编码 / 区域名称 / 区域方向：用于回溯真实桌组位置。",
            "- 主标签 / 次优标签：单标签主场景及第二场景。",
            "- 标签置信度：主次分差对应的高/中/低置信度。",
        ]
    )
    path.write_text("\n".join(lines), encoding="utf-8")


def main() -> None:
    output_dir = make_output_dir()

    integrated_builder.rebuild_upstream_sources()
    group_df, seat_df = integrated_builder.load_scored_workbook()
    multilabel_df = integrated_builder.build_multilabel_df(group_df)
    singlelabel_df = integrated_builder.build_singlelabel_df(group_df)

    feature_df = build_experiment_feature_df(group_df)
    label_df = multilabel_df[list(integrated_builder.SCORE_COLUMN_MAP.keys())].astype(int).copy()
    sample_index_df = pd.DataFrame(
        {
            "样本编号": np.arange(1, len(group_df) + 1, dtype=int),
            "桌组编号": group_df["桌组编号"].astype(str),
            "区域编码": group_df["区域编码"].astype(str),
            "区域名称": group_df["区域名称"].astype(str),
            "区域方向": group_df["区域方向"].astype(str),
            "主标签": singlelabel_df["最终场景标签"].astype(str),
            "次优标签": singlelabel_df["次优场景标签"].astype(str),
            "主次分差": singlelabel_df["主次分差"].astype(float),
            "标签置信度": singlelabel_df["标签置信度"].astype(str),
        }
    )

    export_excel(output_dir / "features.xlsx", feature_df)
    export_excel(output_dir / "labels.xlsx", label_df)
    export_excel(output_dir / "样本索引.xlsx", sample_index_df)
    export_dataset_workbook(
        output_dir / "桌组分类与推荐综合数据集.xlsx",
        group_df=group_df,
        seat_df=seat_df,
        feature_df=feature_df,
        label_df=label_df,
        sample_index_df=sample_index_df,
    )
    export_mat(output_dir / "output.mat", feature_df, label_df)
    write_mat_script(output_dir / "excel_to_mat.py")
    write_readme(output_dir / "使用说明.txt", feature_df, label_df, sample_index_df)

    shutil.copy2(ROOT / "scripts" / "run_mat_sklearn_classification_suite.py", output_dir / "run_mat_sklearn_classification_suite.py")
    shutil.copy2(__file__, output_dir / "build_localized_algorithm_bundle.py")

    print(f"输出目录: {output_dir}")
    print(f"features.xlsx 形状: {feature_df.shape}")
    print(f"labels.xlsx 形状: {label_df.shape}")
    print("标签分布:")
    for column in label_df.columns:
        print(f"  {column}: {int(label_df[column].sum())}")
    print("生成文件:")
    for path in sorted(output_dir.iterdir()):
        print(f"  {path.name}")


if __name__ == "__main__":
    main()
