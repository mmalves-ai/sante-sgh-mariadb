// Domínios do CRUD genérico do módulo `convenio` (W0-01: um arquivo por prefixo; o agregador DOMINIOS_DECLARADOS, em
// ../catalogo.ts, já importa todos, inclusive os vazios). Domínio novo do módulo entra aqui; auxiliares em
// ../ajudantes.ts. Regras da obra: docs/operacoes/README.md.
import { oncologia } from '../ajudantes.js';
import type { DominioPublico } from '../tipos.js';

export const DOMINIOS_CONVENIO: readonly DominioPublico[] = [
  oncologia('tratamentoOncologico', {
    singular: 'Tratamento oncológico de operadora',
    plural: 'Tratamentos oncológicos de operadora',
  }),
  oncologia('perfilOncologico', {
    singular: 'Perfil oncológico de operadora',
    plural: 'Perfis oncológicos de operadora',
  }),
  oncologia('faseOncologica', {
    singular: 'Fase oncológica de operadora',
    plural: 'Fases oncológicas de operadora',
  }),
  oncologia('classificacaoOncologica', {
    singular: 'Classificação oncológica de operadora',
    plural: 'Classificações oncológicas de operadora',
  }),
];
