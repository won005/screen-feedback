module.exports = {
  preset: "react-native",
  testEnvironment: "node",
  setupFiles: ["react-native-gesture-handler/jestSetup.js"],
  testMatch: ["**/test/**/*.test.ts?(x)"],
  transform: {
    "^.+\\.[jt]sx?$": ["babel-jest", {
      babelrc: false,
      configFile: false,
      presets: ["module:@react-native/babel-preset"],
    }],
  },
  transformIgnorePatterns: [
    "node_modules/(?!((jest-)?react-native|@react-native(-community)?|react-native-gesture-handler|react-native-svg)/)",
  ],
  moduleNameMapper: {
    "^@won005/feedback-core$": "<rootDir>/../core/src/index.ts",
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
};
