// Componentes expostos às telas. As telas importam daqui, nunca da biblioteca de base (DP-51, condição 1).
// Base: OpenVue 1.0.0 (MIT, continuação do PrimeVue 4.5.5), com versão fixa (condição 2).
// Correções locais (condições 3 e 4):
// - datepicker em 24 h: `patches/openvue@1.0.0.patch` (`!!ampm`, PR 663 do OpenVue, ainda não publicado);
// - Stepper: o OpenVue marca a lista de passos com `role=tablist` (violação ARIA). Ele só é exposto pelo
//   embrulho `SantePassos`, que corrige os papéis (teste axe em SantePassos.spec.ts).
export { default as Cartao } from 'openvue/card';
export { default as SanteAlerta } from './componentes/SanteAlerta.vue';
export { default as SanteAvisoColisao } from './componentes/SanteAvisoColisao.vue';
export { default as SanteBotao } from './componentes/SanteBotao.vue';
export { default as SanteCabecalhoPaciente } from './componentes/SanteCabecalhoPaciente.vue';
export { default as SanteCampoTexto } from './componentes/SanteCampoTexto.vue';
export { default as SanteChave } from './componentes/SanteChave.vue';
export { default as SanteData } from './componentes/SanteData.vue';
export { default as SanteDialogo } from './componentes/SanteDialogo.vue';
export { default as SanteDialogoGravacao } from './componentes/SanteDialogoGravacao.vue';
export { default as SanteEstado } from './componentes/SanteEstado.vue';
export { default as SanteHora } from './componentes/SanteHora.vue';
export { default as SanteMarca } from './componentes/SanteMarca.vue';
export { default as SanteMarcadores } from './componentes/SanteMarcadores.vue';
export { default as SanteOpcoes } from './componentes/SanteOpcoes.vue';
export { default as SantePassos } from './componentes/SantePassos.vue';
export { default as SanteSelecao } from './componentes/SanteSelecao.vue';
export { default as SanteTabela } from './componentes/SanteTabela.vue';
export { default as SanteIcone } from './icones/SanteIcone.vue';
export type { PedidoGravacao, TestidsGravacao } from './componentes/dialogo-gravacao.js';
export type { ColunaTabela, ConsultaTabela, PaginaTabela } from './componentes/tabela.js';
