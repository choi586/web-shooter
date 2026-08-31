import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    '.next/**',
    'dist/**',
    'out/**',
    'build/**',
    'microbit/**',
    'release/WEB_SHOOTER_microbit_source/**',
    'next-env.d.ts',
  ]),
]);

export default eslintConfig;
