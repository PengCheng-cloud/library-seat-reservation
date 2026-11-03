const LIBRARY_MEDIA_ROOT = "https://your-server.example.com/static/library-gallery";

function buildLibraryAsset(fileName) {
  return `${LIBRARY_MEDIA_ROOT}/${fileName}`;
}

const libraryAssets = {
  exterior: buildLibraryAsset("library-exterior.png"),
  northStudy: buildLibraryAsset("north-study-zone.png"),
  southStudy: buildLibraryAsset("south-study-zone.png"),
  windowStudy: buildLibraryAsset("window-study-zone.jpg"),
  table4: buildLibraryAsset("table-4.jpg"),
  table8: buildLibraryAsset("table-8.jpg"),
  powerOutlet: buildLibraryAsset("power-outlet.jpg"),
  restroom: buildLibraryAsset("restroom.jpg"),
  pantry: buildLibraryAsset("pantry.jpg"),
  corridor: buildLibraryAsset("corridor.jpg"),
  elevatorHall: buildLibraryAsset("elevator-hall.png"),
  airConditioner: buildLibraryAsset("air-conditioner.jpg"),
  floorPlan: buildLibraryAsset("level-7-floor-plan.jpg")
};

const showcaseHero = {
  title: "图书馆主入口",
  subtitle: "先看开放时间与分区状态，再进入地图或 AI 推荐，快速找到更适合今天的座位。",
  image: libraryAssets.exterior,
  badge: "真实馆景",
  note: "馆内实景图会同步用于首页导览与分区说明，方便快速判断环境差异。"
};

const sceneShowcases = [
  {
    key: "sprint",
    title: "冲刺学习",
    subtitle: "适合备考、刷题和长时间高专注自习。",
    image: libraryAssets.northStudy,
    imageTag: "高专注",
    tags: ["安静", "专注", "长时自习"],
    actionType: "preset",
    actionValue: "sprint",
    summary: "这类场景更强调安静度、走动干扰控制和设备续航稳定性，适合一个人连续坐很久。",
    featurePoints: [
      "优先选择安静、靠里侧、远离通道的位置。",
      "如果带电脑，插座位会明显更舒服。",
      "更适合做题、背书、复习这类持续投入任务。"
    ],
    gallery: [
      {
        key: "sprint-north",
        image: libraryAssets.northStudy,
        title: "北侧静学区主视角",
        description: "整体桌组更规整，学习氛围更安静，适合展示系统在高专注场景下的推荐逻辑。",
        tags: ["安静", "主学习区"]
      },
      {
        key: "sprint-power",
        image: libraryAssets.powerOutlet,
        title: "插座位细节",
        description: "适合带电脑或平板长时间学习，续航更稳定，减少中途换位需求。",
        tags: ["有插座", "久坐学习"]
      },
      {
        key: "sprint-corridor",
        image: libraryAssets.corridor,
        title: "避开通道示意",
        description: "越靠近主通道的位置，人流和视觉干扰通常越大，高专注用户更适合避开。",
        tags: ["避开通道", "少打扰"]
      }
    ]
  },
  {
    key: "window",
    title: "临窗阅读",
    subtitle: "适合白天阅读、写字和偏好自然采光的同学。",
    image: libraryAssets.windowStudy,
    imageTag: "自然采光",
    tags: ["靠窗", "采光", "阅读"],
    actionType: "preset",
    actionValue: "window",
    summary: "临窗阅读更强调舒适度和明亮度，适合纸质阅读、写字记录和中长时安静学习。",
    featurePoints: [
      "靠窗与采光充足通常一起出现，白天阅读体验更稳定。",
      "这类座位更适合安静阅读、整理资料和轻量写作。",
      "如果想久坐，也可以同时搭配安静和温度均衡条件。"
    ],
    gallery: [
      {
        key: "window-main",
        image: libraryAssets.windowStudy,
        title: "临窗阅读位",
        description: "自然光更柔和，适合纸质阅读、做笔记和白天长时间停留。",
        tags: ["靠窗", "采光"]
      },
      {
        key: "window-south",
        image: libraryAssets.southStudy,
        title: "南侧舒适视野",
        description: "空间感更通透，更适合需要舒适感和稳定光线的阅读型用户。",
        tags: ["舒适", "通透"]
      },
      {
        key: "window-temperature",
        image: libraryAssets.airConditioner,
        title: "温度体验提醒",
        description: "如果在意冷暖舒适，可以叠加“温度均衡”偏好，尽量避开空调直吹位置。",
        tags: ["温度均衡", "舒适久坐"]
      }
    ]
  },
  {
    key: "group",
    title: "结伴学习",
    subtitle: "适合结伴自习、小组作业和多人设备协同。",
    image: libraryAssets.table8,
    imageTag: "多人协作",
    tags: ["8人桌", "协作", "多人学习"],
    actionType: "preset",
    actionValue: "group",
    summary: "结伴学习不只是找大桌，更要看桌组容量、插座分布、交流便利性和整体空间开放感。",
    featurePoints: [
      "优先考虑多人桌组，保证同伴能坐在同一组。",
      "插座分布和桌面空间对电脑协作场景很关键。",
      "适合轻量讨论、结伴复习、小组作业和资料共享。"
    ],
    gallery: [
      {
        key: "group-table",
        image: libraryAssets.table8,
        title: "八人协作桌",
        description: "多人桌组更适合结伴学习，既方便交流，也适合放置电脑和资料。",
        tags: ["8人桌", "协作"]
      },
      {
        key: "group-power",
        image: libraryAssets.powerOutlet,
        title: "多人设备续航",
        description: "结伴学习时常常会同时使用电脑和平板，插座位会明显提升体验。",
        tags: ["插座位", "电脑学习"]
      },
      {
        key: "group-pantry",
        image: libraryAssets.pantry,
        title: "长时间停留便利性",
        description: "多人学习通常停留时间更长，靠近开水间等配套区域会更方便。",
        tags: ["便利", "长时停留"]
      }
    ]
  },
  {
    key: "flex-study",
    title: "双人轻学习",
    subtitle: "适合单人、双人或轻量交流的学习状态。",
    image: libraryAssets.table4,
    imageTag: "灵活桌组",
    tags: ["4人桌", "灵活", "双人自习"],
    actionType: "filter",
    actionValue: "table_4",
    summary: "这类场景更看重桌组灵活性，不一定追求大空间，但希望有更合适的交流距离和舒适度。",
    featurePoints: [
      "4 人桌更适合一个人展开资料，或两个人并排学习。",
      "相比多人桌，更容易兼顾安静与轻量交流。",
      "很适合展示“桌组类型”和“实际使用场景”之间的对应关系。"
    ],
    gallery: [
      {
        key: "flex-table",
        image: libraryAssets.table4,
        title: "四人轻学习桌",
        description: "四人桌组比多人桌更灵活，适合单人、双人或偶尔交流的学习场景。",
        tags: ["4人桌", "灵活"]
      },
      {
        key: "flex-window",
        image: libraryAssets.windowStudy,
        title: "舒适感补充",
        description: "如果希望双人自习也更舒服，可以叠加靠窗和采光条件，提升整体观感。",
        tags: ["舒适", "采光"]
      }
    ]
  }
];

const spaceGuideCollections = [
  {
    key: "quiet-north",
    title: "北侧静学区",
    subtitle: "更适合备考、冲刺和长时间沉浸式自习。",
    image: libraryAssets.northStudy,
    imageTag: "深度自习",
    tags: ["安静", "专注", "长时自习"],
    actionType: "preset",
    actionValue: "sprint",
    summary: "北侧区域整体更偏向高专注学习氛围，适合展示“安静度”“避开通道”“久坐体验”等推荐因素。",
    featurePoints: [
      "整体更安静，适合一个人长时间沉浸式学习。",
      "更适合和 AI 的“冲刺学习”场景联动展示。",
      "如果后续补更多图片，可以继续加入不同时段和不同视角。"
    ],
    gallery: [
      {
        key: "north-main",
        image: libraryAssets.northStudy,
        title: "静学区整体视角",
        description: "可以突出桌组秩序感、学习密度和安静氛围，适合用于答辩展示。",
        tags: ["安静", "整体视角"]
      },
      {
        key: "north-corridor",
        image: libraryAssets.corridor,
        title: "避开主通道的位置",
        description: "高专注区域通常更强调少走动、少打扰，这也是系统推荐的重要环境特征。",
        tags: ["少打扰", "专注"]
      },
      {
        key: "north-power",
        image: libraryAssets.powerOutlet,
        title: "设备学习补充说明",
        description: "如果用户同时需要高专注和续航稳定，插座位会是更优选。",
        tags: ["插座", "久坐自习"]
      }
    ]
  },
  {
    key: "south-study",
    title: "南侧舒适区",
    subtitle: "视野更开阔，适合日常学习、轻量讨论和长时间停留。",
    image: libraryAssets.southStudy,
    imageTag: "舒适学习",
    tags: ["明亮", "舒适", "通透"],
    actionType: "zone",
    actionValue: "D8",
    summary: "南侧区域空间感更强，适合展示“舒适感”“明亮度”和“适合长时间停留”的差异化体验。",
    featurePoints: [
      "比纯静学区更强调舒适和空间感。",
      "适合展示不同分区环境差异，不只是看是否有空位。",
      "后续补图时，推荐继续拍广角和近景两种视角。"
    ],
    gallery: [
      {
        key: "south-main",
        image: libraryAssets.southStudy,
        title: "南侧区域主视角",
        description: "空间更开阔，适合说明舒适度、视野和普通学习场景的平衡。",
        tags: ["舒适", "通透"]
      },
      {
        key: "south-window",
        image: libraryAssets.windowStudy,
        title: "自然采光补充",
        description: "这类区域很适合补充靠窗与采光图，帮助展示不同偏好下的环境差异。",
        tags: ["采光", "舒适久坐"]
      },
      {
        key: "south-elevator",
        image: libraryAssets.elevatorHall,
        title: "到达动线说明",
        description: "补充电梯厅或到达动线照片，可以让空间导览更完整、更像真实系统说明。",
        tags: ["动线", "到达方式"]
      }
    ]
  },
  {
    key: "window-reading",
    title: "临窗阅读位",
    subtitle: "适合白天阅读、写字和偏好自然采光的同学。",
    image: libraryAssets.windowStudy,
    imageTag: "自然采光",
    tags: ["靠窗", "采光", "阅读"],
    actionType: "preset",
    actionValue: "window",
    summary: "临窗位适合展示“自然光”“舒适阅读”和“靠窗偏好”之间的直观关系，特别适合首页做展示型入口。",
    featurePoints: [
      "用户很容易通过图片理解什么叫“靠窗”与“采光充足”。",
      "适合与阅读、写字、长时间停留等需求联动。",
      "如果后续继续补图，建议增加晴天、阴天、傍晚等不同光感。"
    ],
    gallery: [
      {
        key: "window-guide-main",
        image: libraryAssets.windowStudy,
        title: "临窗主视角",
        description: "自然光条件更直观，适合做偏好说明和系统截图展示。",
        tags: ["靠窗", "采光"]
      },
      {
        key: "window-guide-south",
        image: libraryAssets.southStudy,
        title: "舒适感补充场景",
        description: "可以结合开阔视野说明为什么这类位置更适合长时间阅读。",
        tags: ["舒适", "阅读"]
      }
    ]
  },
  {
    key: "group-collab",
    title: "八人协作桌",
    subtitle: "适合结伴自习、小组作业和多人设备协同。",
    image: libraryAssets.table8,
    imageTag: "多人协作",
    tags: ["8人桌", "协作", "小组学习"],
    actionType: "preset",
    actionValue: "group",
    summary: "多人桌组很适合展示系统对“结伴学习”“多人桌”“插座位”等联合特征的识别与推荐。",
    featurePoints: [
      "是首页常用场景里最适合做展示说明的一类图片。",
      "用户一看图片就能理解为什么适合结伴学习。",
      "后续继续补图时，建议补桌面细节和多人使用感。"
    ],
    gallery: [
      {
        key: "group-guide-main",
        image: libraryAssets.table8,
        title: "多人协作桌主视角",
        description: "多人桌组更适合结伴学习和小组作业，适合在答辩中展示场景映射能力。",
        tags: ["多人桌", "协作"]
      },
      {
        key: "group-guide-power",
        image: libraryAssets.powerOutlet,
        title: "多人设备支持",
        description: "如果同时用电脑和平板，插座位会明显提升多人学习体验。",
        tags: ["插座", "多人设备"]
      },
      {
        key: "group-guide-pantry",
        image: libraryAssets.pantry,
        title: "长时间停留便利性",
        description: "靠近开水间等设施也能作为展示结伴学习场景的补充特征。",
        tags: ["便利", "长时停留"]
      }
    ]
  },
  {
    key: "light-study",
    title: "四人轻学习桌",
    subtitle: "适合单人、双人或轻量交流的学习场景。",
    image: libraryAssets.table4,
    imageTag: "灵活桌组",
    tags: ["4人桌", "灵活", "双人自习"],
    actionType: "filter",
    actionValue: "table_4",
    summary: "四人桌组适合说明不同桌组类型在使用场景上的差异，也是后续继续补图的好入口。",
    featurePoints: [
      "适合单人展开资料，也适合双人并排学习。",
      "比多人桌更容易兼顾安静和交流边界。",
      "适合与“灵活”“轻量交流”等文案联动。"
    ],
    gallery: [
      {
        key: "light-main",
        image: libraryAssets.table4,
        title: "四人桌主视角",
        description: "桌组更灵活，适合单人、双人和轻量交流，是很好的展示型素材。",
        tags: ["4人桌", "灵活"]
      },
      {
        key: "light-window",
        image: libraryAssets.windowStudy,
        title: "舒适度补充视角",
        description: "如果搭配靠窗和采光条件，也能形成很舒服的双人学习场景。",
        tags: ["舒适", "双人自习"]
      }
    ]
  }
];

const featureGallery = [
  {
    key: "power_outlet",
    title: "插座位",
    subtitle: "适合电脑学习、设备作业和长时间续航。",
    image: libraryAssets.powerOutlet,
    badge: "筛选特征",
    tags: ["有插座", "设备学习"],
    note: "点击后可直接加入“有插座”筛选。",
    actionType: "filter",
    actionValue: "power_outlet"
  },
  {
    key: "window",
    title: "靠窗学习位",
    subtitle: "视野更开阔，白天采光表现更好。",
    image: libraryAssets.windowStudy,
    badge: "筛选特征",
    tags: ["靠窗", "舒适久坐"],
    note: "适合展示靠窗偏好与实景图片之间的映射关系。",
    actionType: "filter",
    actionValue: "window"
  },
  {
    key: "sunlight_yes",
    title: "采光充足",
    subtitle: "更适合白天看书、做题和纸质阅读。",
    image: libraryAssets.windowStudy,
    badge: "筛选特征",
    tags: ["采光", "明亮"],
    note: "与靠窗场景联动，突出自然光条件。",
    actionType: "filter",
    actionValue: "sunlight_yes"
  },
  {
    key: "quiet",
    title: "安静氛围",
    subtitle: "减少走动干扰，更适合沉浸式学习。",
    image: libraryAssets.northStudy,
    badge: "筛选特征",
    tags: ["安静", "专注"],
    note: "用于展示高专注学习需求的偏好识别。",
    actionType: "filter",
    actionValue: "quiet"
  },
  {
    key: "balanced_temperature",
    title: "温度均衡",
    subtitle: "尽量避开空调直吹区域，久坐更舒适。",
    image: libraryAssets.airConditioner,
    badge: "筛选特征",
    tags: ["空调", "温度舒适"],
    note: "适合体现系统对环境舒适度的综合考虑。",
    actionType: "filter",
    actionValue: "balanced_temperature"
  },
  {
    key: "quiet_position",
    title: "避开通道",
    subtitle: "减少人员走动带来的分心和打扰。",
    image: libraryAssets.corridor,
    badge: "筛选特征",
    tags: ["少打扰", "避开通道"],
    note: "适合高专注用户快速收敛到更安静的位置。",
    actionType: "filter",
    actionValue: "quiet_position"
  },
  {
    key: "table_4",
    title: "四人桌",
    subtitle: "更适合单人、双人或轻量交流。",
    image: libraryAssets.table4,
    badge: "筛选特征",
    tags: ["4人桌", "灵活"],
    note: "点击后可直接启用四人桌筛选。",
    actionType: "filter",
    actionValue: "table_4"
  },
  {
    key: "table_8",
    title: "八人桌",
    subtitle: "适合结伴自习、小组作业和协同学习。",
    image: libraryAssets.table8,
    badge: "筛选特征",
    tags: ["8人桌", "协作"],
    note: "点击后可直接启用八人桌筛选。",
    actionType: "filter",
    actionValue: "table_8"
  },
  {
    key: "near_restroom",
    title: "邻近卫生间",
    subtitle: "适合短时停留或更关注便利性的用户。",
    image: libraryAssets.restroom,
    badge: "筛选特征",
    tags: ["便利", "卫生间"],
    note: "如果用户在意中途离席便利性，可以直接启用该筛选。",
    actionType: "filter",
    actionValue: "near_restroom"
  },
  {
    key: "pantry",
    title: "开水间",
    subtitle: "长时间学习时补水更加方便。",
    image: libraryAssets.pantry,
    badge: "馆内设施",
    tags: ["补水", "便利"],
    note: "该项用于补充空间设施展示，不直接参与筛选。",
    actionType: "",
    actionValue: ""
  },
  {
    key: "elevator",
    title: "电梯厅",
    subtitle: "可用于说明楼层到达方式与馆内动线。",
    image: libraryAssets.elevatorHall,
    badge: "馆内设施",
    tags: ["到达", "动线"],
    note: "用于说明楼层到达方式、空间组织与阅读动线。",
    actionType: "",
    actionValue: ""
  }
];

const algorithmHighlights = [
  {
    key: "nlp-parse",
    title: "自然语言需求解析",
    description: "把“想要安静、靠窗、能充电”这类描述转换为结构化偏好标签。",
    accent: "语义输入"
  },
  {
    key: "scene-model",
    title: "SVM 需求-座位多标签匹配",
    description: "将一段用户需求与候选座位组合成匹配样本，输出深度专注、舒适久学、设备作业和开放协作四类匹配标签。",
    accent: "部署模型"
  },
  {
    key: "mlp-compare",
    title: "MLP 神经网络对比",
    description: "MLP 参与同一 features/labels 数据集的多算法对比，用于说明深度学习模型在当前表格数据上的表现。",
    accent: "深度学习"
  },
  {
    key: "rank-score",
    title: "多条件排序推荐",
    description: "综合 SVM 匹配概率、偏好命中、时间窗可用性和业务规则输出 TopN 结果。",
    accent: "推荐输出"
  }
];

const assistantPrompts = [
  "我想找一个安静、靠窗、能充电的位置，适合下午自习。",
  "我和同学一起学习，想找多人桌，最好也能给电脑充电。",
  "我晚上来图书馆，希望避开通道、温度舒适一些。"
];

const librarySupplementGallery = [
  {
    key: "arrival-exterior",
    title: "图书馆外立面",
    subtitle: "适合放在空间导览页最前面，让别人先看到建筑入口和整体氛围。",
    image: libraryAssets.exterior,
    tags: ["馆外实景", "入口", "整体形象"],
    summary: "这张图可以作为导览起点，说明系统展示的不只是座位结果，还有真实场馆环境。"
  },
  {
    key: "arrival-floor-plan",
    title: "七层总平面图",
    subtitle: "用来解释各分区在整层里的位置关系，适合和地图页联动。",
    image: libraryAssets.floorPlan,
    tags: ["平面图", "分区布局", "地图说明"],
    summary: "如果答辩时要解释 Q 区、D 区、西侧和东侧是怎么划分的，这张图最直观。"
  },
  {
    key: "arrival-elevator",
    title: "电梯厅与到达动线",
    subtitle: "适合说明读者如何从到达楼层进入学习区域。",
    image: libraryAssets.elevatorHall,
    tags: ["电梯厅", "动线", "到达方式"],
    summary: "这类图片能把空间导览从单纯看照片，变成对真实使用路径的说明。"
  },
  {
    key: "facility-corridor",
    title: "主通道环境",
    subtitle: "适合解释为什么高专注用户通常更希望避开通道边的位置。",
    image: libraryAssets.corridor,
    tags: ["主通道", "走动干扰", "安静度"],
    summary: "它可以和系统里的“避开通道”偏好直接对应起来，体现推荐逻辑有真实空间依据。"
  },
  {
    key: "facility-pantry",
    title: "开水间与补给点",
    subtitle: "适合补充长时间自习场景下的便利性说明。",
    image: libraryAssets.pantry,
    tags: ["开水间", "便利设施", "长时停留"],
    summary: "对于久坐自习和结伴学习，这张图可以说明为什么有些区域在便利性上更有优势。"
  },
  {
    key: "facility-restroom",
    title: "卫生间位置示意",
    subtitle: "适合说明短时停留、中途离席和便利性偏好。",
    image: libraryAssets.restroom,
    tags: ["卫生间", "便利性", "暂离场景"],
    summary: "这张图可以和“邻近卫生间”偏好联动，展示筛选条件与真实环境之间的映射。"
  },
  {
    key: "facility-air",
    title: "空调与温度体验",
    subtitle: "适合说明温度均衡、空调直吹和久坐舒适度。",
    image: libraryAssets.airConditioner,
    tags: ["空调", "温度舒适", "久坐体验"],
    summary: "这张图能帮助解释“温度均衡”这种抽象偏好，背后其实对应的是具体空间体验。"
  },
  {
    key: "facility-power",
    title: "插座与设备学习支持",
    subtitle: "适合解释电脑自习、多设备协作为什么更依赖插座位。",
    image: libraryAssets.powerOutlet,
    tags: ["插座", "设备学习", "续航"],
    summary: "这张图既能用在场景页，也能用在空间补充图集里，说明设备需求的识别不是抽象标签。"
  }
];

const showcaseCollections = {
  space: {
    title: "空间导览",
    subtitle: "按分区和真实馆景查看学习氛围，后续只要继续往配置里补图片就能自动扩展。",
    items: spaceGuideCollections,
    supplementalTitle: "馆内设施与动线图集",
    supplementalSubtitle: "把你已经上传到云端的入口、平面图、卫生间、开水间、空调、插座等图片统一展示出来。",
    supplementalItems: librarySupplementGallery
  },
  scene: {
    title: "常用场景",
    subtitle: "按学习场景查看典型图片、环境特征和系统筛选逻辑，适合展示给老师或同学看。",
    items: sceneShowcases
  }
};

function getShowcaseCollection(type) {
  return showcaseCollections[type] || showcaseCollections.space;
}

function getShowcaseItems(type) {
  return getShowcaseCollection(type).items || [];
}

function getShowcaseItem(type, key) {
  return getShowcaseItems(type).find((item) => item.key === key) || null;
}

const spaceGuides = spaceGuideCollections.map((item) => ({
  key: item.key,
  title: item.title,
  subtitle: item.subtitle,
  image: item.image,
  imageTag: item.imageTag,
  note: item.summary,
  tags: item.tags,
  actionType: item.actionType,
  actionValue: item.actionValue
}));

module.exports = {
  buildLibraryAsset,
  libraryAssets,
  showcaseHero,
  spaceGuides,
  spaceGuideCollections,
  sceneShowcases,
  showcaseCollections,
  librarySupplementGallery,
  featureGallery,
  algorithmHighlights,
  assistantPrompts,
  getShowcaseCollection,
  getShowcaseItems,
  getShowcaseItem
};
