const api = require("../../services/api");
const { getCurrentUser, setCurrentUser } = require("../../utils/auth");
const { relaunchPage } = require("../../utils/navigation");

function getFormKeyByTab(tab) {
  return tab === "register" ? "registerForm" : "loginForm";
}

Page({
  data: {
    activeTab: "login",
    loading: false,
    feedbackMessage: "",
    feedbackType: "info",
    loginForm: {
      studentNo: "",
      realName: "",
      password: ""
    },
    registerForm: {
      studentNo: "",
      realName: "",
      password: ""
    }
  },

  onLoad(options) {
    this.redirectUrl = decodeURIComponent((options && options.redirect) || "/pages/home/index");

    const currentUser = getCurrentUser();
    if (currentUser) {
      this.finishAuth(currentUser, {
        silent: true
      });
    }
  },

  normalizeForm(form) {
    return {
      studentNo: String((form && form.studentNo) || "").trim(),
      realName: String((form && form.realName) || "").trim(),
      password: String((form && form.password) || "")
    };
  },

  setFeedback(message, type = "error") {
    this.setData({
      feedbackMessage: message,
      feedbackType: type
    });
  },

  clearFeedback() {
    if (!this.data.feedbackMessage) {
      return;
    }

    this.setData({
      feedbackMessage: "",
      feedbackType: "info"
    });
  },

  switchTab(event) {
    const { tab } = event.currentTarget.dataset;
    if (!tab || tab === this.data.activeTab) {
      return;
    }

    const currentFormKey = getFormKeyByTab(this.data.activeTab);
    const nextFormKey = getFormKeyByTab(tab);
    const currentForm = this.normalizeForm(this.data[currentFormKey]);
    const nextForm = this.normalizeForm(this.data[nextFormKey]);

    const nextData = {
      activeTab: tab,
      feedbackMessage: "",
      feedbackType: "info"
    };

    if (!nextForm.studentNo && currentForm.studentNo) {
      nextData[`${nextFormKey}.studentNo`] = currentForm.studentNo;
    }

    if (!nextForm.realName && currentForm.realName) {
      nextData[`${nextFormKey}.realName`] = currentForm.realName;
    }

    this.setData(nextData);
  },

  handleInput(event) {
    const { formKey, field } = event.currentTarget.dataset;
    let value = event.detail.value || "";

    if (field === "studentNo") {
      value = value.replace(/\D/g, "").slice(0, 10);
    }

    this.setData({
      [`${formKey}.${field}`]: value
    });
    this.clearFeedback();
  },

  validateForm(form) {
    const normalized = this.normalizeForm(form);

    if (!/^\d{10}$/.test(normalized.studentNo)) {
      return "学号需为 10 位数字";
    }

    if (!normalized.realName) {
      return "请输入姓名";
    }

    if (normalized.password.length < 8) {
      return "密码至少需要 8 位";
    }

    return "";
  },

  buildSessionUser(response) {
    const user = response && response.user ? response.user : {};

    return {
      userId: user.userId || "",
      studentNo: user.studentNo || "",
      realName: user.realName || "",
      role: user.role || "reader",
      status: user.status || "active",
      creditScore: Number(user.creditScore || 0),
      isBlacklisted: Boolean(user.isBlacklisted),
      blacklistUntil: user.blacklistUntil || ""
    };
  },

  finishAuth(user, options = {}) {
    const { silent = false, toastTitle = "登录成功" } = options;

    setCurrentUser(user);

    if (!silent) {
      wx.showToast({
        title: toastTitle,
        icon: "success",
        duration: 900
      });
    }

    setTimeout(() => {
      relaunchPage(this.redirectUrl || "/pages/home/index");
    }, silent ? 0 : 360);
  },

  handleLoginError(error, form) {
    if (error.code === "USER_NOT_FOUND" || error.statusCode === 404) {
      this.setData({
        activeTab: "register",
        registerForm: {
          studentNo: form.studentNo,
          realName: form.realName,
          password: ""
        }
      });
      this.setFeedback("该学号尚未注册，已自动切换到注册页。", "warning");
      return;
    }

    this.setFeedback(error.message || "登录失败，请稍后重试", "error");
  },

  handleRegisterError(error, form) {
    if (error.code === "STUDENT_NO_ALREADY_REGISTERED" || error.statusCode === 409) {
      this.setData({
        activeTab: "login",
        loginForm: {
          studentNo: form.studentNo,
          realName: form.realName,
          password: ""
        }
      });
      this.setFeedback("该学号已注册，已自动切换到登录页。", "warning");
      return;
    }

    this.setFeedback(error.message || "注册失败，请稍后重试", "error");
  },

  async submitLogin() {
    const form = this.normalizeForm(this.data.loginForm);
    const message = this.validateForm(form);
    if (message) {
      this.setFeedback(message, "error");
      return;
    }

    this.setData({
      loading: true,
      feedbackMessage: "",
      feedbackType: "info"
    });

    try {
      const response = await api.login(form);

      this.setData({
        loading: false
      });

      this.finishAuth(this.buildSessionUser(response), {
        toastTitle: "登录成功"
      });
    } catch (error) {
      this.setData({
        loading: false
      });
      this.handleLoginError(error, form);
    }
  },

  async submitRegister() {
    const form = this.normalizeForm(this.data.registerForm);
    const message = this.validateForm(form);
    if (message) {
      this.setFeedback(message, "error");
      return;
    }

    this.setData({
      loading: true,
      feedbackMessage: "",
      feedbackType: "info"
    });

    try {
      const response = await api.register(form);

      this.setData({
        loading: false
      });

      this.finishAuth(this.buildSessionUser(response), {
        toastTitle: "注册成功"
      });
    } catch (error) {
      this.setData({
        loading: false
      });
      this.handleRegisterError(error, form);
    }
  }
});
