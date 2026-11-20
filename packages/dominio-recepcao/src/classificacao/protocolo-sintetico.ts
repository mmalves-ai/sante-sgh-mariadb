// Protocolo SINTÉTICO de classificação (ficha do M44, seção 14: contorno da DP-18): motor, telas e testes rodam com
// ele enquanto a diretoria clínica não decide entre o Manchester licenciado e o ACCR próprio. Não é protocolo
// clínico: discriminadores e limites são ilustrativos, para exercitar as regras (cor mais grave vence, regra por
// sinal, discriminador só manual, fluxograma com sugestão de protocolo gerenciado). Nunca publicado em produção: o nome
// o diz, e a publicação de produção exige a aprovação da diretoria clínica.
import type { ConteudoProtocolo } from '@sgh/contratos';
import { CORES_RISCO } from '@sgh/contratos';

export const NOME_PROTOCOLO_SINTETICO = 'Protocolo sintético de teste (não clínico)';

export const PROTOCOLO_SINTETICO: ConteudoProtocolo = {
  tipo: 'accr',
  nome: NOME_PROTOCOLO_SINTETICO,
  // O de-para cor → opção de "Prioridade clínica" do formulário do prontuário segue a ordem das opções vista no perfil
  // do estabelecimento pc (1 vermelho … 5 azul); a enfermagem aprova o de-para da versão de produção.
  cores: CORES_RISCO.map((c) => ({
    cor: c.codigo,
    nome: c.nome,
    tempoAlvoMin: c.tempoAlvoPadraoMin,
    opcaoE08: c.prioridade,
    corLegado: c.prioridade,
  })),
  fluxogramas: [
    { codigo: 'geral', titulo: 'Mal-estar geral' },
    { codigo: 'dor-toracica', titulo: 'Dor torácica' },
    { codigo: 'dispneia', titulo: 'Falta de ar' },
  ],
  discriminadores: [
    {
      codigo: 'via-aerea',
      fluxograma: 'geral',
      titulo: 'Via aérea comprometida',
      cor: 'vermelho',
      regra: null,
      sugereProtocolo: null,
    },
    {
      codigo: 'saturacao-muito-baixa',
      fluxograma: 'geral',
      titulo: 'Saturação abaixo de 85%',
      cor: 'vermelho',
      regra: { '<': [{ var: 'saturacao' }, 85] },
      sugereProtocolo: null,
    },
    {
      codigo: 'febre-alta',
      fluxograma: 'geral',
      titulo: 'Temperatura de 39 °C ou mais',
      cor: 'amarelo',
      regra: { '>=': [{ var: 'temperatura' }, 39] },
      sugereProtocolo: null,
    },
    {
      codigo: 'dor-moderada',
      fluxograma: 'geral',
      titulo: 'Dor de 5 a 7',
      cor: 'amarelo',
      regra: { and: [{ '>=': [{ var: 'dor' }, 5] }, { '<=': [{ var: 'dor' }, 7] }] },
      sugereProtocolo: null,
    },
    {
      codigo: 'problema-recente',
      fluxograma: 'geral',
      titulo: 'Problema recente',
      cor: 'verde',
      regra: null,
      sugereProtocolo: null,
    },
    {
      codigo: 'dor-precordial',
      fluxograma: 'dor-toracica',
      titulo: 'Dor precordial típica',
      cor: 'laranja',
      regra: null,
      sugereProtocolo: 'dor-toracica',
    },
    {
      codigo: 'choque',
      fluxograma: 'dor-toracica',
      titulo: 'Pressão sistólica abaixo de 90 mmHg',
      cor: 'vermelho',
      regra: { '<': [{ var: 'pas' }, 90] },
      sugereProtocolo: null,
    },
    {
      codigo: 'dor-intensa',
      fluxograma: 'dor-toracica',
      titulo: 'Dor de 8 a 10',
      cor: 'laranja',
      regra: { '>=': [{ var: 'dor' }, 8] },
      sugereProtocolo: null,
    },
    {
      codigo: 'saturacao-baixa',
      fluxograma: 'dispneia',
      titulo: 'Saturação abaixo de 92%',
      cor: 'laranja',
      regra: { '<': [{ var: 'saturacao' }, 92] },
      sugereProtocolo: null,
    },
    {
      codigo: 'taquipneia',
      fluxograma: 'dispneia',
      titulo: 'Frequência respiratória acima de 24 irpm',
      cor: 'amarelo',
      regra: { '>': [{ var: 'fr' }, 24] },
      sugereProtocolo: null,
    },
  ],
  licenca: null,
};
