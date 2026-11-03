const activeEnv = "local";

const endpoints = {
  prod: "https://your-server.example.com/api",
  local: "http://127.0.0.1:3000/api"
};

module.exports = {
  activeEnv,
  endpoints,
  apiBaseUrl: endpoints[activeEnv],
  requestTimeout: 15000
};
