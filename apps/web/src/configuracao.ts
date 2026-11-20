import type { InjectionKey } from 'vue';
import type { PacoteMarca } from '@sgh/ui';

/** Marca e nome do produto da rede (GET /api/marca; DP-49). */
export const CHAVE_MARCA: InjectionKey<{ produto: string; pacote: PacoteMarca }> = Symbol('marca');

/** Versões gravadas no build (vite.config.ts); fora do build, valores de desenvolvimento. */
export const VERSAO_WEB = {
  identificacao: typeof __SGH_WEB_VERSAO__ === 'string' ? __SGH_WEB_VERSAO__ : '0.0.0-dev',
  openvue: typeof __SGH_OPENVUE__ === 'string' ? __SGH_OPENVUE__ : '?',
  vue: typeof __SGH_VUE__ === 'string' ? __SGH_VUE__ : '?',
} as const;
