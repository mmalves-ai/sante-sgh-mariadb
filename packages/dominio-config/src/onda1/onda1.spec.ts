import {
  type EstadoOperacao,
  type ItemLigar,
  ITENS_POR_SETOR,
  operacoesLiberaveisOnda1,
} from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { avaliarLigarSetor, guiasDoSetorOnda1, indicadoresDisputa, mapaImpactoMarkdown } from './onda1.js';

const todas = (setor: Parameters<typeof operacoesLiberaveisOnda1>[0], estado: EstadoOperacao) =>
  Object.fromEntries(operacoesLiberaveisOnda1(setor).map((n) => [n, estado]));

const cumpridos = (setor: keyof typeof ITENS_POR_SETOR): ItemLigar[] =>
  ITENS_POR_SETOR[setor]
    .filter((i) => i !== 'operacoes-conferidas')
    .map((item) => ({
      item,
      situacao: 'cumprido',
      evidencia: 'docs/marcos/M39/evidencias.md',
      em: '2026-11-09',
    }));

describe('avaliarLigarSetor (regra 1)', () => {
  it('liga com tudo conferido e cada item cumprido', () => {
    const r = avaliarLigarSetor({
      setor: 'agendamento',
      hospital: 'pc',
      estados: todas('agendamento', 'conferida'),
      itens: cumpridos('agendamento'),
      ondasProntasNoPrimeiro: false,
      bloqueio: null,
    });
    expect(r.veredito).toBe('pode-ligar');
    expect(r.operacoesPendentes).toEqual([]);
    expect(r.itens.find((i) => i.item === 'operacoes-conferidas')?.detalhe).toMatch(
      /^(\d+) de \1 conferidas$/,
    );
  });

  it('operação só verde na cópia não basta: falta a conferência', () => {
    const estados = {
      ...todas('recepcao-ambulatorial', 'liberada'),
      'recepcao.chamarSenha': 'verde' as const,
    };
    const r = avaliarLigarSetor({
      setor: 'recepcao-ambulatorial',
      hospital: 'pc',
      estados,
      itens: cumpridos('recepcao-ambulatorial'),
      ondasProntasNoPrimeiro: false,
      bloqueio: null,
    });
    expect(r.veredito).toBe('falta');
    expect(r.operacoesPendentes).toEqual([{ nome: 'recepcao.chamarSenha', estado: 'verde' }]);
  });

  it('item sem registro conta como pendente; não se aplica não segura', () => {
    const itens = cumpridos('recepcao-ambulatorial').filter((i) => i.item !== 'teste-retorno');
    itens.push({ item: 'tvs', situacao: 'nao-se-aplica', evidencia: '', em: null });
    const r = avaliarLigarSetor({
      setor: 'recepcao-ambulatorial',
      hospital: 'pc',
      estados: todas('recepcao-ambulatorial', 'conferida'),
      itens,
      ondasProntasNoPrimeiro: false,
      bloqueio: null,
    });
    expect(r.veredito).toBe('falta');
    expect(r.itens.find((i) => i.item === 'teste-retorno')).toMatchObject({
      situacao: 'pendente',
      detalhe: 'sem registro',
    });
  });

  it('o segundo estabelecimento fica bloqueado até todas as ondas prontas no primeiro (DP-4)', () => {
    const base = {
      setor: 'cadastros-estrutura' as const,
      hospital: 'hs',
      estados: todas('cadastros-estrutura', 'conferida'),
      itens: cumpridos('cadastros-estrutura'),
      bloqueio: null,
    };
    expect(avaliarLigarSetor({ ...base, ondasProntasNoPrimeiro: false }).veredito).toBe('bloqueado');
    expect(avaliarLigarSetor({ ...base, ondasProntasNoPrimeiro: true }).veredito).toBe('pode-ligar');
    expect(avaliarLigarSetor({ ...base, ondasProntasNoPrimeiro: true, bloqueio: 'HS-1' }).bloqueio).toBe(
      'HS-1',
    );
  });

  it('a agenda de exames não entra na liberação e aparece como fora da onda (DP-8)', () => {
    const r = avaliarLigarSetor({
      setor: 'agendamento',
      hospital: 'pc',
      estados: todas('agendamento', 'conferida'),
      itens: [],
      ondasProntasNoPrimeiro: false,
      bloqueio: null,
    });
    expect(operacoesLiberaveisOnda1('agendamento')).not.toContain('agenda.agendarExame');
    expect(r.foraDaOnda.map((o) => o.nome)).toEqual(
      expect.arrayContaining(['agenda.agendarExame', 'agenda.cancelarExame']),
    );
    expect(r.foraDaOnda.every((o) => o.motivo.startsWith('DP-8'))).toBe(true);
  });
});

describe('indicadoresDisputa', () => {
  it('soma por setor com as parcelas impressas e separa as senhas por sistema', () => {
    const r = indicadoresDisputa({
      hospital: 'pc',
      dia: '2026-11-09',
      contagens: [
        {
          operacao: 'agenda.agendarConsulta',
          hospital: 'pc',
          conflitosVersao: 1,
          travas: 2,
          recusasPorCodigo: { 'horario-ocupado': 3 },
        },
        {
          operacao: 'agenda.encaixar',
          hospital: 'pc',
          conflitosVersao: 0,
          travas: 1,
          recusasPorCodigo: { 'horario-ocupado': 1, manual: 4 },
        },
        {
          operacao: 'recepcao.chamarSenha',
          hospital: 'pc',
          conflitosVersao: 0,
          travas: 5,
          recusasPorCodigo: {},
        },
        {
          operacao: 'agenda.agendarConsulta',
          hospital: 'hs',
          conflitosVersao: 9,
          travas: 9,
          recusasPorCodigo: {},
        },
      ],
      usoDia: [{ operacao: 'recepcao.chamarSenha', noNovo: 40, noLegado: 160 }],
    });
    const agenda = r.setores.find((s) => s.setor === 'agendamento');
    expect(agenda).toMatchObject({
      colisoesGrade: 4,
      recusasHorarioOcupado: 4,
      esperasTrava: 3,
      senhas: null,
    });
    expect(agenda?.parcelas).toMatchObject({
      'colisoes-grade': 'agendarConsulta 3 + encaixar 1 = 4',
      'recusas-horario-ocupado': 'agendarConsulta 3 + encaixar 1 = 4',
      'esperas-trava': 'agendarConsulta 2 + encaixar 1 = 3',
      'senhas-por-sistema': 'não se aplica',
    });
    const recepcao = r.setores.find((s) => s.setor === 'recepcao-ambulatorial');
    expect(recepcao).toMatchObject({
      colisoesGrade: 0,
      esperasTrava: 5,
      senhas: { noNovo: 40, noOutro: 160, total: 200 },
    });
    expect(recepcao?.parcelas['senhas-por-sistema']).toBe('40 no novo + 160 no outro = 200');
    expect(recepcao?.parcelas['esperas-trava']).toBe('chamarSenha 5');
    expect(r.setores.find((s) => s.setor === 'cadastros-estrutura')?.parcelas['colisoes-grade']).toBe('0');
  });
});

describe('mapaImpactoMarkdown', () => {
  it('diz o que muda, para quem e quando, sem citar o outro sistema e sem contagem pequena', () => {
    const md = mapaImpactoMarkdown({
      setor: 'agendamento',
      nomeSetor: 'Agendamento e call center',
      hospital: 'pc',
      aPartirDe: null,
      publico: [
        { papel: 'recepcao', pessoas: 12 },
        { papel: 'supervisao', pessoas: 4 },
      ],
    });
    expect(md).toContain('A partir de: a definir na autorização do setor');
    expect(md).toContain('recepcao 12 + supervisao <5 = 16 pessoa(s)');
    expect(md).toContain('Agenda de consultas');
    expect(md).toMatch(/Fica para depois: a tela Agenda de exames \(DP-8/);
    expect(md).toMatch(/Fica para depois: agenda\.agendarExame\./);
    expect(md).not.toMatch(/Agenda de exames .* passa a ser feita/);
    expect(md).not.toMatch(/spdata|legado/i);
  });
});

describe('guiasDoSetorOnda1 (revisão do M39)', () => {
  const guia = (caminho: string, onda: number, ...abra: string[]) => ({
    caminho,
    texto: `# Guia\n\nGuia de uma página (papel recepcao, onda ${onda}).\n\n${abra.map((a, i) => `${i + 1}. Abra **${a}**.`).join('\n')}`,
  });
  const guias = [
    guia('recepcao/abrir-atendimento.guia.md', 1, 'Recepção › Atendimento › Abertura de atendimento'),
    guia(
      'recepcao/chamar-senha.guia.md',
      1,
      'Recepção › Senhas e filas › Emissão e chamada de senhas por guichê',
    ),
    guia('recepcao/cadastrar-paciente.guia.md', 1, 'Cadastros › Pacientes › Cadastro e busca de paciente'),
    guia(
      'recepcao/marcar-consulta.guia.md',
      1,
      'Agenda › Agenda ambulatorial › Marcação, encaixe, remarcação e confirmação',
    ),
    guia(
      'recepcao/internar.guia.md',
      2,
      'Internação e leitos › Leitos › Mapa de leitos operacional',
      'Recepção › Atendimento › Abertura de atendimento',
    ),
  ];

  it('deixa fora o guia de outra onda (a internação é da onda 2) e o de outro setor', () => {
    expect(guiasDoSetorOnda1('recepcao-ambulatorial', guias)).toEqual([
      'recepcao/abrir-atendimento.guia.md',
      'recepcao/chamar-senha.guia.md',
    ]);
    expect(guiasDoSetorOnda1('cadastros-estrutura', guias)).toEqual(['recepcao/cadastrar-paciente.guia.md']);
    expect(guiasDoSetorOnda1('agendamento', guias)).toEqual(['recepcao/marcar-consulta.guia.md']);
  });
});
