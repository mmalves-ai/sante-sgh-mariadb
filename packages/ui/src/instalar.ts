import type { App } from 'vue';
import OpenVue from 'openvue/config';
import { localeOpenVuePtBR } from './i18n/openvue-pt-BR.js';
import type { PacoteMarca } from './marca/index.js';
import { CLASSE_ESCURO } from './tema/css.js';
import { injetarTokens } from './tema/injetar.js';
import { protegerImpressao } from './tema/impressao.js';
import { criarPresetMarca } from './tema/preset.js';
import './tema/fontes.js';
import './tema/base.css';

/**
 * Instala a biblioteca de componentes com o tema da marca. As telas usam só `@sgh/ui`, nunca a
 * biblioteca direto (DP-51): trocar a base (OpenVue 1, PrimeVue 4.5.5 ou PrimeVue 5) mexe só neste pacote.
 */
export function instalarUi(app: App, marca: PacoteMarca, documento: Document = document): void {
  app.use(OpenVue, {
    locale: localeOpenVuePtBR,
    theme: {
      preset: criarPresetMarca(marca),
      options: { darkModeSelector: `.${CLASSE_ESCURO}`, cssLayer: false },
    },
  });
  injetarTokens(documento, marca);
  if (documento.defaultView) protegerImpressao(documento.defaultView);
}
