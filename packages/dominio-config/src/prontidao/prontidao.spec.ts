// Prontidão por setor (ficha do M35, regras 1, 2, 5, 7 e 8): veredito, lista do cap-15 §15.3.2, público por papel
// com as parcelas do cap-15 §15.4.1, proposta das ondas 0 e 1 e as chaves preparadas (todas desligadas).
import {
  type CargaProntidao,
  type DefinicaoSetor,
  esquemaHospitalProntidao,
  PAPEIS,
  SETORES_PRONTIDAO,
  TOTAL_REFERENCIA_PUBLICO,
} from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import {
  avaliarHospital,
  avaliarSetor,
  chaveDoGrupo,
  chavesAPreparar,
  contagemSegura,
  guiasDoSetor,
  lerQuadroMarcos,
  marcoConstruido,
  publicoPorPapel,
} from './prontidao.js';

const carga = (resultado: 'verde' | 'vermelho', indicativo = true): CargaProntidao => ({
  cenario: 'carga-somada',
  executadoEm: '2026-10-23T00:00:00.000Z',
  usuarios: 400,
  resultado,
  indicativo,
  jornadas: [],
  outroSistema: [],
  mon: { transacaoMaisLongaMs: 80, acimaDoLimite: 0, escritas: 0 },
  arquivo: 'docs/marcos/M35/carga-carga-somada.json',
});

const setor: DefinicaoSetor = {
  id: 'teste',
  nome: 'Setor de teste',
  onda: 1,
  papeis: ['recepcao'],
  operacoes: ['agenda.*', '!agenda.*Exame*'],
  leituras: ['pauta'],
  recursos: ['agenda.consulta'],
  marcos: ['M17'],
  jornadas: [],
  roteiro: [],
  duvidas: ['DP-3'],
};

const ops = [
  { nome: 'agenda.agendarConsulta', estado: 'verde' as const, motivo: '' },
  { nome: 'agenda.agendarSemProntuario', estado: 'especificada' as const, motivo: 'D-SPR-1' },
  { nome: 'agenda.agendarExame', estado: 'especificada' as const, motivo: 'outro setor' },
  { nome: 'cadastro.cadastrarPaciente', estado: 'verde' as const, motivo: '' },
];

describe('quadro de marcos', () => {
  it('lê o status de cada marco do ESTADO.md (a primeira linha vale)', () => {
    const q = lerQuadroMarcos(
      '| M17 | 2 | B | aguardando-validacao | 2026-10-21 | x |\n| M28 | 3 | D | pendente | — | — |\n| M17 | 2 | B | outro | — | — |\nlixo',
    );
    expect(q).toEqual({ M17: 'aguardando-validacao', M28: 'pendente' });
    expect(marcoConstruido(q['M17'])).toBe(true);
    expect(marcoConstruido('aceito (pc; hs aguarda HS-1)')).toBe(true);
    expect(marcoConstruido(q['M28'])).toBe(false);
    expect(marcoConstruido(undefined)).toBe(false);
  });
});

describe('veredito do setor', () => {
  it('pronto com ressalvas: construído, com a operação fora de verde listada com o motivo; o padrão `!` exclui', () => {
    const s = avaliarSetor({
      setor,
      operacoes: ops,
      marcos: { M17: 'aguardando-validacao' },
      carga: carga('verde'),
      guiasPorPapel: { recepcao: 3 },
      bloqueio: null,
    });
    expect(s.veredito).toBe('pronto-com-ressalvas');
    expect(s.operacoes).toEqual({
      total: 2,
      verdes: 1,
      fora: [{ nome: 'agenda.agendarSemProntuario', estado: 'especificada', motivo: 'D-SPR-1' }],
    });
    const it = Object.fromEntries(s.itens.map((i) => [i.item, i.situacao]));
    expect(it).toEqual({
      construcao: 'atendido',
      operacoes: 'com-ressalva',
      aceite: 'fase4',
      treinamento: 'fase4',
      estacoes: 'fase4',
      carga: 'atendido',
      apoio: 'fase4',
      pentest: 'fase4',
    });
    expect(s.itens.find((i) => i.item === 'carga')?.detalhe).toContain('indicativo');
    expect(s.ordemFase4).toEqual([]);
  });

  it('pronto para homologar: todas verdes; sem operação de gravação, só leitura', () => {
    const s = avaliarSetor({
      setor: { ...setor, operacoes: ['agenda.agendarConsulta'] },
      operacoes: ops,
      marcos: { M17: 'aceito' },
      carga: carga('verde', false),
      guiasPorPapel: { recepcao: 1 },
      bloqueio: null,
    });
    expect(s.veredito).toBe('pronto-para-homologar');
    expect(s.itens.find((i) => i.item === 'carga')?.detalhe).not.toContain('indicativo');
    const leitura = avaliarSetor({
      setor: { ...setor, operacoes: [] },
      operacoes: ops,
      marcos: { M17: 'aceito' },
      carga: carga('verde'),
      guiasPorPapel: {},
      bloqueio: null,
    });
    expect(leitura.veredito).toBe('pronto-para-homologar');
    expect(leitura.itens.find((i) => i.item === 'operacoes')?.detalhe).toContain('só leitura');
    expect(leitura.itens.find((i) => i.item === 'treinamento')?.situacao).toBe('nao-atendido');
  });

  it('em construção: marco pendente vai à ordem da Fase 4; sem medição de carga, não atendido; motivo vazio vira aviso', () => {
    const s = avaliarSetor({
      setor: { ...setor, marcos: ['M31', 'M12', 'M28'] },
      operacoes: [{ nome: 'agenda.x', estado: 'referencia', motivo: '' }],
      marcos: { M12: 'aguardando-validacao', M28: 'pendente' },
      carga: null,
      guiasPorPapel: {},
      bloqueio: null,
    });
    expect(s.veredito).toBe('nao-construido');
    expect(s.ordemFase4).toEqual(['M28', 'M31']);
    expect(s.itens.find((i) => i.item === 'carga')?.situacao).toBe('nao-atendido');
    expect(s.operacoes.fora[0]?.motivo).toBe('sem motivo registrado');
    const vermelha = avaliarSetor({
      setor,
      operacoes: ops,
      marcos: { M17: 'aceito' },
      carga: carga('vermelho'),
      guiasPorPapel: {},
      bloqueio: null,
    });
    expect(vermelha.itens.find((i) => i.item === 'carga')?.situacao).toBe('nao-atendido');
  });

  it('bloqueado (HS-1): todos os itens bloqueados com o motivo', () => {
    const s = avaliarSetor({
      setor,
      operacoes: ops,
      marcos: { M17: 'aceito' },
      carga: carga('verde'),
      guiasPorPapel: {},
      bloqueio: 'HS-1',
    });
    expect(s.veredito).toBe('bloqueado');
    expect(s.itens.every((i) => i.situacao === 'bloqueado' && i.detalhe === 'HS-1')).toBe(true);
  });
});

describe('público por papel (cap-15 §15.4.1)', () => {
  it('as referências somam 727 (326 + 154 + 74 + 31 + 31 + 22 + 15 + 10 + 23 + 41)', () => {
    const p = publicoPorPapel(null, {});
    expect(p.map((x) => x.referencia)).toEqual([326, 154, 74, 31, 31, 22, 15, 10, 23, 41]);
    expect(p.reduce((t, x) => t + x.referencia, 0)).toBe(TOTAL_REFERENCIA_PUBLICO);
    expect(p.every((x) => x.usuarios === null && !x.menorQue5)).toBe(true);
  });

  it('soma a medida por grupo (sem acento), o grupo não nomeado vai a "Outros" e abaixo de 5 vira <5', () => {
    const p = publicoPorPapel(
      { MÉDICOS: 300, MEDICOS_SUPERVISAO: 3, FINANCEIRO: 2, 'GRUPO NOVO': 9, 'SEM GRUPO': 20 },
      { medico: 2 },
    );
    const medico = p.find((x) => x.papel === 'medico');
    expect(medico?.usuarios).toBe(303);
    expect(medico?.guias).toBe(2);
    expect(medico?.parcelas.find((x) => x.grupo === 'MEDICOS_SUPERVISAO')).toMatchObject({
      usuarios: null,
      menorQue5: true,
      referencia: 6,
    });
    const fin = p.find((x) => x.papel === 'financeiro');
    expect(fin).toMatchObject({ usuarios: null, menorQue5: true });
    const outros = p.find((x) => x.papel === 'outros');
    expect(outros?.parcelas.find((x) => x.grupo === 'GRUPO NOVO')).toMatchObject({
      usuarios: 9,
      referencia: null,
    });
    expect(outros?.usuarios).toBe(29);
  });

  it('chave do grupo e contagem segura', () => {
    expect(chaveDoGrupo('  Atendimento_Pronto   Atendimento ')).toBe('ATENDIMENTO_PRONTO ATENDIMENTO');
    expect(contagemSegura(null)).toBe('—');
    expect(contagemSegura(0)).toBe('0');
    expect(contagemSegura(4)).toBe('<5');
    expect(contagemSegura(5)).toBe('5');
  });
});

describe('estabelecimento e proposta das ondas', () => {
  const operacoes = SETORES_PRONTIDAO.flatMap(() => []);
  const marcos = Object.fromEntries(
    [
      'M10',
      'M11',
      'M12',
      'M13',
      'M14',
      'M15',
      'M16',
      'M17',
      'M18',
      'M19',
      'M20',
      'M21',
      'M22',
      'M23',
      'M24',
      'M25',
      'M26',
      'M27',
      'M34',
    ].map((m) => [m, 'aguardando-validacao']),
  );

  it('pc: propõe a onda 0 e a onda 1 com os setores prontos; o que está em construção fica fora com o motivo', () => {
    const h = avaliarHospital({
      codigo: 'pc',
      nome: 'Hospital Geral',
      bloqueio: null,
      operacoes,
      marcos: { ...marcos, M17: 'pendente' },
      carga: carga('verde'),
      porGrupo: { MEDICOS: 320 },
      guiasPorPapel: { gestao: 5, recepcao: 6 },
      chaves: { preparadas: 10, ligadas: 0 },
    });
    expect(esquemaHospitalProntidao.parse(h)).toBeTruthy();
    expect(h.proposta.onda0).toEqual(['consultas-gestao']);
    expect(h.proposta.onda1).toEqual(['cadastros-estrutura', 'recepcao-ambulatorial']);
    expect(h.proposta.foraDaProposta).toEqual([{ setor: 'agendamento', motivo: 'em construção: M17' }]);
    expect(h.publicoTotal).toBe(320);
    expect(h.chavesPreparadas).toBe(10);
    expect(h.setores.find((s) => s.id === 'faturamento-convenio')?.veredito).toBe('nao-construido');
  });

  it('hs sem cópia: tudo bloqueado, sem público e sem proposta (DP-4: o Serrano vem depois)', () => {
    const h = avaliarHospital({
      codigo: 'hs',
      nome: 'Hospital Serrano',
      bloqueio: 'HS-1: sem a cópia',
      operacoes,
      marcos,
      carga: null,
      porGrupo: { MEDICOS: 1 },
      guiasPorPapel: {},
      chaves: null,
      setores: [setor],
    });
    expect(h.setores.map((s) => s.veredito)).toEqual(['bloqueado']);
    expect(h.publicoTotal).toBeNull();
    expect(h.chavesPreparadas).toBeNull();
    expect(h.proposta).toEqual({
      onda0: [],
      onda1: [],
      foraDaProposta: [{ setor: 'teste', motivo: 'HS-1: sem a cópia' }],
    });
    const semMotivo = avaliarHospital({
      codigo: 'hs',
      nome: 'x',
      bloqueio: ' ',
      operacoes,
      marcos,
      carga: null,
      porGrupo: null,
      guiasPorPapel: {},
      chaves: null,
      setores: [setor],
    });
    expect(semMotivo.proposta.foraDaProposta[0]?.motivo).toBe('sem a cópia');
  });
});

describe('catálogo de setores e chaves preparadas', () => {
  it('toda tarefa e todo setor usam papéis conhecidos; os setores cobrem as ondas 0 a 5', () => {
    const papeis = new Set(PAPEIS.map((p) => p.id));
    expect(SETORES_PRONTIDAO.every((s) => s.papeis.every((p) => papeis.has(p)))).toBe(true);
    expect([...new Set(SETORES_PRONTIDAO.map((s) => s.onda))].sort()).toEqual([0, 1, 2, 3, 4, 5]);
    expect(new Set(SETORES_PRONTIDAO.map((s) => s.id)).size).toBe(SETORES_PRONTIDAO.length);
  });

  it('uma entrada por recurso com os grupos dos papéis dos setores que o usam (sem o "SEM GRUPO")', () => {
    const c = chavesAPreparar();
    const consulta = c.find((x) => x.recurso === 'agenda.consulta');
    expect(consulta?.setores).toEqual(['agendamento']);
    expect(consulta?.grupos).toContain('ATENDIMENTO');
    expect(c.every((x) => !x.grupos.includes('SEM GRUPO'))).toBe(true);
    const paineis = c.find((x) => x.recurso === 'relatorio.paineis');
    expect(paineis?.setores).toEqual(['consultas-gestao', 'restantes']);
    expect(chavesAPreparar([setor])).toEqual([
      {
        recurso: 'agenda.consulta',
        grupos: [
          'ATENDIMENTO',
          'ATENDIMENTO_INTERNACAO',
          'ATENDIMENTO_PRONTO ATENDIMENTO',
          'ATENDIMENTO_SUPERVISAO',
        ],
        setores: ['teste'],
      },
    ]);
  });
});

describe('padrão de operação do setor (curinga sem expressão montada)', () => {
  it('prefixo, sufixo, partes do meio em ordem e o nome exato', async () => {
    const { casaPadraoOperacao } = await import('@sgh/contratos');
    expect(casaPadraoOperacao('agenda.*', 'agenda.agendarConsulta')).toBe(true);
    expect(casaPadraoOperacao('agenda.*', 'cadastro.x')).toBe(false);
    expect(casaPadraoOperacao('agenda.*Exame*', 'agenda.agendarExameSemProntuario')).toBe(true);
    expect(casaPadraoOperacao('agenda.*Exame*', 'agenda.cancelarExame')).toBe(true);
    expect(casaPadraoOperacao('agenda.*Exame*', 'agenda.agendarConsulta')).toBe(false);
    expect(casaPadraoOperacao('a*b*c', 'abc')).toBe(true);
    expect(casaPadraoOperacao('a*b*c', 'ac')).toBe(false);
    expect(casaPadraoOperacao('ab*bc', 'abc')).toBe(false);
    expect(casaPadraoOperacao('a*bb*c', 'abc')).toBe(false);
    expect(casaPadraoOperacao('sadt.lancarExame', 'sadt.lancarExame')).toBe(true);
    expect(casaPadraoOperacao('sadt.lancarExame', 'sadt.lancarExames')).toBe(false);
  });
});

describe('treinamento por papel e por onda (revisão do M35, regra 5)', () => {
  const porPapel = { gestao: 5, medico: 3, enfermagem: 1, recepcao: 8 };
  const porPapelOnda = { gestao: { 0: 5 }, medico: { 2: 3 }, enfermagem: { 2: 1 }, recepcao: { 1: 7, 2: 1 } };

  it('o setor de consultas da onda 0 não soma os guias de médico e enfermagem da onda 2', () => {
    const consultas = SETORES_PRONTIDAO.find((s) => s.id === 'consultas-gestao');
    expect(consultas?.onda).toBe(0);
    expect(consultas?.papeis).toEqual(expect.arrayContaining(['gestao', 'medico', 'enfermagem']));
    if (!consultas) return;
    expect(guiasDoSetor(consultas, porPapel)).toBe(9);
    expect(guiasDoSetor(consultas, porPapel, porPapelOnda)).toBe(5);
  });

  it('as ondas até a do setor contam (a onda 2 da recepção soma a 1 e a 2); sem a onda, todos os guias do papel', () => {
    expect(guiasDoSetor({ papeis: ['recepcao'], onda: 1 }, porPapel, porPapelOnda)).toBe(7);
    expect(guiasDoSetor({ papeis: ['recepcao'], onda: 2 }, porPapel, porPapelOnda)).toBe(8);
    expect(guiasDoSetor({ papeis: ['medico'], onda: 1 }, porPapel, porPapelOnda)).toBe(0);
    expect(guiasDoSetor({ papeis: ['recepcao'], onda: 1 }, porPapel)).toBe(8);
  });

  it('no relatório do hospital, o item treinamento do setor sai com a contagem da onda', () => {
    const consultas = SETORES_PRONTIDAO.find((s) => s.id === 'consultas-gestao');
    if (!consultas) throw new Error('setor consultas-gestao ausente');
    const h = avaliarHospital({
      codigo: 'pc',
      nome: 'ProntoCardio',
      bloqueio: null,
      operacoes: [],
      marcos: {},
      carga: null,
      porGrupo: null,
      guiasPorPapel: porPapel,
      guiasPorPapelOnda: porPapelOnda,
      chaves: null,
      setores: [consultas],
    });
    expect(h.setores[0]?.itens.find((i) => i.item === 'treinamento')?.detalhe).toMatch(/^5 guia\(s\)/);
  });
});
