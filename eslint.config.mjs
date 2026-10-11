import js from "@eslint/js";
import ts from "typescript-eslint";
import globals from "globals";
import hooks from "eslint-plugin-react-hooks";
export default ts.config({ignores:["dist/**","node_modules/**","vendor/**","registry/**","research/**","src/components/ui/**"]},js.configs.recommended,...ts.configs.recommended,{files:["**/*.{ts,tsx}"],languageOptions:{globals:{...globals.browser,...globals.node}},plugins:{"react-hooks":hooks},rules:{"react-hooks/rules-of-hooks":"error","react-hooks/exhaustive-deps":"warn"}},{files:["scripts/*.mjs"],languageOptions:{globals:globals.node}});
