// M61 (ADR 0034): o comando liberacao:ligar-tudo sobre uma porta em memória (sem banco): exclusões, produção sem
// referência, pré-requisitos, reversão, limite de linhas e o relatório sem dado de pessoa.
import { RECURSOS_DESLIGADOS } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import {
  codigoDeSaida,
  executarLiberacaoFull,
  type LinhaChaveFull,
  type OpcoesLiberacaoFull,
  type PortaLiberacaoFull,
  type PrerequisitoLidoFull,
  relatorioEmTexto,
} from './liberacao-full.ts';
import { argumentosLiberacao } from './liberacao-ligar-tudo.ts';

/** Banco em memória: as linhas de SGH_CFG_LIBERACAO e SGH_CFG_PREREQUISITO de um estabelecimento sintético. */
function bancoEmMemoria(inicial: LinhaChaveFull[] = [], pre: PrerequisitoLidoFull[] = []) {
  let linhas = [...inicial];
  let prereqs = [...pre];
  let lote = 100;
  const trilha: string[] = [];
  const porta: PortaLiberacaoFull = {
    async contarLinhas() {
      return { decidem: linhas.filter((l) => l.ligada !== null).length, todas: linhas.length };
    },
    async chaves() {
      return linhas.filter((l) => l.ligada !== null);
    },
    async prerequisitos() {
      return prereqs;
    },
    async lotesMarcados() {
      return linhas.filter((l) => l.lote && (l.justificativa ?? '').startsWith('LIBERACAO-FULL '));
    },
    async aplicarLotes(_h, pedidos, evento) {
      // Uma transação: tudo ou nada.
      const copia = [...linhas];
      const r: { lote: string; alteradas: number }[] = [];
      try {
        for (const p of pedidos) {
          const minhas = linhas.filter((l) => l.chave === p.chave);
          const plano = p.planejar({
            chaves: minhas,
            prerequisitos: prereqs.filter((x) => x.recurso === p.chave),
          });
          if (plano.length === 0) {
            r.push({ lote: '', alteradas: 0 });
            continue;
          }
          const n = String(++lote);
          for (const m of plano) {
            const i = linhas.findIndex(
              (l) => l.chave === p.chave && l.escopo === m.escopo && l.valor === m.valor,
            );
            const nova: LinhaChaveFull = {
              tipo: p.tipo,
              chave: p.chave,
              escopo: m.escopo,
              valor: m.valor,
              ligada: m.ligada,
              ligadaAntes: m.antes,
              lote: n,
              justificativa: p.justificativa,
            };
            if (i >= 0) linhas[i] = nova;
            else linhas.push(nova);
          }
          trilha.push(`${evento}:${p.chave}`);
          r.push({ lote: n, alteradas: plano.length });
        }
      } catch (e) {
        linhas = copia;
        throw e;
      }
      return r;
    },
    async gravarPrerequisito(_h, p) {
      prereqs = [
        ...prereqs.filter((x) => !(x.recurso === p.recurso && x.tipo === p.tipo)),
        {
          recurso: p.recurso,
          tipo: p.tipo,
          situacao: p.situacao,
          validade: p.validade,
          evidencia: p.evidencia,
        },
      ];
      trilha.push(`prerequisito:${p.recurso}:${p.tipo}`);
    },
    async regraFarmacia() {
      return 'Unidades sem a prescrição em uso: UTI.';
    },
  };
  return { porta, linhas: () => linhas, prereqs: () => prereqs, trilha };
}

const OPERACOES = ['cadastro.alterarPaciente', 'sadt.emitirLaudo'];
const opcoes = (o: Partial<OpcoesLiberacaoFull> = {}): OpcoesLiberacaoFull => ({
  ambiente: 'dev',
  hospitais: ['pc'],
  operacoes: OPERACOES,
  estadoEfetivo: () => 'verde',
  referencia: null,
  incluir: [],
  soListar: false,
  agora: new Date('2026-10-30T15:00:00Z'),
  ...o,
});
const linha = (
  chave: string,
  escopo: LinhaChaveFull['escopo'],
  valor: string,
  ligada: boolean | null,
): LinhaChaveFull => ({
  tipo: 'recurso',
  chave,
  escopo,
  valor,
  ligada,
  ligadaAntes: null,
  lote: null,
  justificativa: 'sintética',
});

describe('liberacao:ligar-tudo em dev', () => {
  it('liga tudo menos as exclusões; as específicas desligadas passam a herdar; os pré-requisitos dispensados', async () => {
    const b = bancoEmMemoria([
      linha('sessoes', 'pessoa', 'SINT.A', false),
      linha('sessoes', 'grupo', 'SINT_GRUPO', true),
      linha('integracao.classificacaoExterna', 'hospital', '*', true),
    ]);
    const r = await executarLiberacaoFull(opcoes(), b.porta, 'ligar');
    const h = r.hospitais[0]!;
    expect(r.excluidas.map((e) => e.chave).sort()).toEqual([
      'entrada.utf8',
      'integracao.classificacaoExterna',
      'integracao.mensagensPaciente',
      'operadora.mensagens',
      'relatorio.envioAgendado',
    ]);
    // A farmácia (regra 1 da onda 3) recusa na cópia sem prescrição em uso: pendência, não para as outras.
    expect(h.pendentes.map((p) => p.chave).sort()).toEqual([
      'suprimentos.dispensacao',
      'suprimentos.entrega',
    ]);
    expect(h.ligadas.length).toBe(RECURSOS_DESLIGADOS.length - 5 - 2 + OPERACOES.length);
    expect(h.especificasHerdando).toBe(1);
    expect(h.prerequisitosPendentes).toEqual([]);
    const sessoes = b.linhas().filter((l) => l.chave === 'sessoes');
    expect(sessoes.find((l) => l.escopo === 'pessoa')).toMatchObject({ ligada: null, ligadaAntes: false });
    expect(sessoes.find((l) => l.escopo === 'grupo')?.ligada).toBe(true);
    expect(sessoes.find((l) => l.escopo === 'hospital')).toMatchObject({ ligada: true, ligadaAntes: null });
    // Regra 6: ligar a própria desligou a externa na mesma transação.
    expect(b.linhas().find((l) => l.chave === 'integracao.classificacaoExterna')?.ligada).toBe(false);
    expect(b.linhas().some((l) => l.chave === 'operadora.mensagens')).toBe(false);
    // Contrato e certificado também dispensados em dev (autorização de 30/10/2026), com a marca na evidência.
    const ans = b.prereqs().filter((p) => p.recurso === 'operadora.ans');
    expect(ans.map((p) => p.situacao)).toEqual(['dispensado', 'dispensado']);
    expect(ans[0]?.evidencia?.startsWith('LIBERACAO-FULL 2026-10-30')).toBe(true);
    // Segunda rodada: nada a mudar.
    const de_novo = await executarLiberacaoFull(opcoes(), b.porta, 'ligar');
    expect(de_novo.hospitais[0]!.ligadas).toEqual([]);
    expect(de_novo.hospitais[0]!.prerequisitosGravados).toBe(0);
    // O relatório não leva valor de escopo (login, grupo, setor).
    const texto = relatorioEmTexto(r, false);
    expect(texto).not.toContain('SINT.A');
    expect(texto).not.toContain('SINT_GRUPO');
    expect(texto).toContain('300 s');
    expect(codigoDeSaida(r)).toBe(0);
  });

  it('--so-listar não grava nada', async () => {
    const b = bancoEmMemoria();
    const r = await executarLiberacaoFull(opcoes({ soListar: true }), b.porta, 'ligar');
    expect(r.modo).toBe('listar');
    expect(r.hospitais[0]!.ligadas.length).toBeGreaterThan(100);
    expect(b.linhas()).toEqual([]);
    expect(b.prereqs()).toEqual([]);
    expect(b.trilha).toEqual([]);
  });

  it('--so-listar: a dispensa simulada substitui o registro de antes (pendente ou vencido), como a gravação', async () => {
    const registrado: PrerequisitoLidoFull[] = [
      {
        recurso: 'sessoes',
        tipo: 'aprovacao',
        situacao: 'pendente',
        validade: null,
        evidencia: 'aguardando o setor',
      },
      {
        recurso: 'operadora.ans',
        tipo: 'certificado',
        situacao: 'cumprido',
        validade: '2026-01-01',
        evidencia: 'e-CNPJ de 2025',
      },
    ];
    const plano = await executarLiberacaoFull(
      opcoes({ soListar: true }),
      bancoEmMemoria([], registrado).porta,
      'ligar',
    );
    const real = await executarLiberacaoFull(opcoes(), bancoEmMemoria([], registrado).porta, 'ligar');
    const nomes = (xs: readonly { chave: string }[]) => xs.map((x) => x.chave).sort();
    expect(nomes(plano.hospitais[0]!.ligadas)).toContain('sessoes');
    expect(nomes(plano.hospitais[0]!.ligadas)).toContain('operadora.ans');
    // O plano bate com o que a gravação faz.
    expect(nomes(plano.hospitais[0]!.ligadas)).toEqual(nomes(real.hospitais[0]!.ligadas));
    expect(nomes(plano.hospitais[0]!.pendentes)).toEqual(nomes(real.hospitais[0]!.pendentes));
  });

  it('--reverter desfaz os lotes da marca do mais novo ao mais antigo e devolve os pré-requisitos a pendente', async () => {
    const b = bancoEmMemoria([
      linha('sessoes', 'pessoa', 'SINT.A', false),
      linha('integracao.classificacaoExterna', 'hospital', '*', true),
      { ...linha('licitacao', 'grupo', 'X', true), lote: '7', justificativa: 'lote do painel' },
    ]);
    await executarLiberacaoFull(opcoes(), b.porta, 'ligar');
    const r = await executarLiberacaoFull(opcoes(), b.porta, 'reverter');
    // Religar a externa pela reversão passa pelas conferências de ligar: sem o pré-requisito dela, fica pendente.
    expect(r.hospitais[0]!.pendentes.map((p) => p.chave)).toEqual(['integracao.classificacaoExterna']);
    expect(r.hospitais[0]!.revertidos).toBeGreaterThan(100);
    const sessoes = b.linhas().filter((l) => l.chave === 'sessoes');
    expect(sessoes.find((l) => l.escopo === 'pessoa')?.ligada).toBe(false);
    expect(sessoes.find((l) => l.escopo === 'hospital')?.ligada).toBeNull();
    expect(b.linhas().find((l) => l.chave === 'integracao.classificacaoExterna')?.ligada).toBe(false);
    expect(b.linhas().find((l) => l.chave === 'licitacao' && l.escopo === 'grupo')?.ligada).toBe(true);
    expect(b.prereqs().every((p) => p.situacao === 'pendente')).toBe(true);
  });

  it('--reverter devolve o pré-requisito ao registro de antes (situação, validade e evidência)', async () => {
    const b = bancoEmMemoria(
      [],
      [
        {
          recurso: 'sessoes',
          tipo: 'aprovacao',
          situacao: 'cumprido',
          validade: '2026-01-01',
          evidencia: 'ata da aprovação do setor 12/2025',
        },
        {
          recurso: 'operadora.ans',
          tipo: 'certificado',
          situacao: 'pendente',
          validade: null,
          evidencia: 'aguardando DP-36',
        },
      ],
    );
    await executarLiberacaoFull(opcoes(), b.porta, 'ligar');
    const dispensado = b.prereqs().find((p) => p.recurso === 'sessoes' && p.tipo === 'aprovacao');
    expect(dispensado?.situacao).toBe('dispensado');
    expect(dispensado?.evidencia?.length).toBeLessThanOrEqual(200);
    await executarLiberacaoFull(opcoes(), b.porta, 'reverter');
    expect(b.prereqs().find((p) => p.recurso === 'sessoes' && p.tipo === 'aprovacao')).toEqual({
      recurso: 'sessoes',
      tipo: 'aprovacao',
      situacao: 'cumprido',
      validade: '2026-01-01',
      evidencia: 'ata da aprovação do setor 12/2025',
    });
    expect(b.prereqs().find((p) => p.recurso === 'operadora.ans' && p.tipo === 'certificado')).toEqual({
      recurso: 'operadora.ans',
      tipo: 'certificado',
      situacao: 'pendente',
      validade: null,
      evidencia: 'aguardando DP-36',
    });
    // Sem registro antes: volta a pendente, com a marca da reversão.
    const semAntes = b.prereqs().find((p) => p.recurso === 'operadora.ans' && p.tipo === 'aprovacao');
    expect(semAntes?.situacao).toBe('pendente');
    expect(semAntes?.evidencia).toMatch(/^Reversão da LIBERACAO-FULL/);
  });

  it('--reverter não religa a classificação externa com a própria ligada (regra 6, conferida na transação)', async () => {
    const aprovada = (tipo: 'aprovacao'): PrerequisitoLidoFull => ({
      recurso: 'integracao.classificacaoExterna',
      tipo,
      situacao: 'cumprido',
      validade: null,
      evidencia: 'sintética',
    });
    const b = bancoEmMemoria(
      [linha('integracao.classificacaoExterna', 'hospital', '*', true)],
      [aprovada('aprovacao')],
    );
    await executarLiberacaoFull(opcoes(), b.porta, 'ligar');
    expect(b.linhas().find((l) => l.chave === 'integracao.classificacaoExterna')?.ligada).toBe(false);
    // Alguém mexe na própria pela tela de chaves: o lote dela deixa de ser da marca (a reversão não o desfaz).
    const i = b.linhas().findIndex((l) => l.chave === 'pa.classificacao' && l.escopo === 'hospital');
    b.linhas()[i] = { ...b.linhas()[i]!, lote: '9999', justificativa: 'tela de chaves' };
    const r = await executarLiberacaoFull(opcoes(), b.porta, 'reverter');
    expect(b.linhas().find((l) => l.chave === 'pa.classificacao' && l.escopo === 'hospital')?.ligada).toBe(
      true,
    );
    expect(b.linhas().find((l) => l.chave === 'integracao.classificacaoExterna')?.ligada).toBe(false);
    const p = r.hospitais[0]!.pendentes.find((x) => x.chave === 'integracao.classificacaoExterna');
    expect(p?.motivo).toMatch(/Uma fonte de cor/);
  });
});

describe('liberacao:ligar-tudo fora de dev', () => {
  it('produção sem referência recusa antes de ler o banco', async () => {
    const b = bancoEmMemoria();
    await expect(executarLiberacaoFull(opcoes({ ambiente: 'producao' }), b.porta, 'ligar')).rejects.toThrow(
      /--referencia/,
    );
    await expect(executarLiberacaoFull(opcoes({ ambiente: 'homolog' }), b.porta, 'reverter')).rejects.toThrow(
      /--referencia/,
    );
  });

  it('produção, --so-listar sem referência: mostra o plano (nada gravado)', async () => {
    const b = bancoEmMemoria();
    const r = await executarLiberacaoFull(opcoes({ ambiente: 'producao', soListar: true }), b.porta, 'ligar');
    expect(r.hospitais[0]!.ligadas.some((c) => c.chave === 'sessoes')).toBe(true);
    expect(r.hospitais[0]!.pendentes.some((p) => /Autorização obrigatória/.test(p.motivo))).toBe(false);
    expect(b.linhas()).toEqual([]);
  });

  it('produção: decisão do dono fora (salvo --incluir), operações à espera do catálogo, contrato pendente', async () => {
    const b = bancoEmMemoria();
    const r = await executarLiberacaoFull(
      opcoes({
        ambiente: 'producao',
        referencia: 'ESTADO.md › Autorizações 2026-10-30',
        incluir: ['financeiro.fiscal'],
      }),
      b.porta,
      'ligar',
    );
    const h = r.hospitais[0]!;
    const fora = new Set(r.excluidas.map((e) => e.chave));
    expect(fora.has('operadora.mensagens')).toBe(true);
    expect(fora.has('catalogo.cid.responsavel')).toBe(true);
    expect(fora.has('financeiro.fiscal')).toBe(false);
    expect(h.aguardandoCatalogo.map((c) => c.chave)).toEqual(OPERACOES);
    // Sem o avaliador do critério do setor no terminal, as chaves das ondas 2 a 4 ficam pendentes (falha fechada).
    expect(h.pendentes.some((p) => /Critério de liberação incompleto/.test(p.motivo))).toBe(true);
    // Contrato, certificado e credenciamento nunca se dispensam por comando em produção.
    expect(h.prerequisitosPendentes.some((p) => p.chave === 'faturamento.susCiha')).toBe(false);
    expect(h.prerequisitosPendentes.map((p) => p.tipoPrerequisito)).not.toContain('aprovacao');
    // ...e o relatório os lista como pendentes (não basta omiti-los).
    const pend = (chave: string, tipo: string) =>
      h.prerequisitosPendentes.some((p) => p.chave === chave && p.tipoPrerequisito === tipo);
    expect(pend('pessoas.esocial', 'certificado')).toBe(true);
    expect(pend('operadora.ans', 'certificado')).toBe(true);
    expect(
      h.prerequisitosPendentes.every((p) =>
        ['contrato', 'certificado', 'credenciamento'].includes(p.tipoPrerequisito),
      ),
    ).toBe(true);
    // A superfície pública do portal pede decisão do dono (a aprovação dela seria dispensada).
    expect(fora.has('portal.conta')).toBe(true);
    expect(fora.has('portal.agenda')).toBe(true);
    expect(h.ligadas.some((c) => c.chave.startsWith('portal.'))).toBe(false);
    // O relatório dá a lista dos testes pós-implantação sem a incluída (as outras de decisão continuam vigiadas).
    const linhaFumaca = relatorioEmTexto(r, false)
      .split('\n')
      .find((x) => x.includes('IMPLANTACAO_CHAVES_ESPERADAS='));
    expect(linhaFumaca).toContain('faturamento.susAih');
    expect(linhaFumaca).not.toContain('financeiro.fiscal');
    expect(b.prereqs().every((p) => p.situacao === 'dispensado')).toBe(true);
    expect(b.prereqs().some((p) => p.tipo !== 'aprovacao')).toBe(false);
    const sessoes = b.linhas().find((l) => l.chave === 'sessoes' && l.escopo === 'hospital');
    expect(sessoes?.ligada).toBe(true);
    expect(b.linhas().some((l) => l.chave === 'pessoas.esocial' && l.ligada)).toBe(false);
  });
});

describe('limite de linhas e argumentos', () => {
  it('recusa o estabelecimento que passaria de 4500 linhas (nada gravado)', async () => {
    const muitas = Array.from({ length: 4400 }, (_, i) =>
      linha(`sintetica.${i}`, 'pessoa', `SINT.${i}`, true),
    );
    const b = bancoEmMemoria(muitas);
    const r = await executarLiberacaoFull(opcoes(), b.porta, 'ligar');
    expect(r.hospitais[0]!.recusa).toMatch(/teto 4500/);
    expect(b.linhas()).toHaveLength(4400);
    expect(codigoDeSaida(r)).toBe(2);
  });

  it('argumentos: as opções conhecidas; o resto é recusado', () => {
    expect(
      argumentosLiberacao(['--hospital=pc', '--so-listar', '--referencia=linha do dono', '--incluir=a,b']),
    ).toEqual({
      hospital: 'pc',
      soListar: true,
      reverter: false,
      referencia: 'linha do dono',
      incluir: ['a', 'b'],
    });
    expect(() => argumentosLiberacao(['--forcar'])).toThrow(/desconhecida/);
    expect(() => argumentosLiberacao(['pc'])).toThrow(/não reconhecido/);
  });
});
