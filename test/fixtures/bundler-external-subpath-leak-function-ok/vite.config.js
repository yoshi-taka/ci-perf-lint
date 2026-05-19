export default {
  external: (id) => ["react", "react-dom"].some((base) => id === base || id.startsWith(`${base  }/`)),
  build: { target: "es2020" },
};
