// M53.1: o serviço da interface com a folha externa sobre as portas EM MEMÓRIA (dados SINTÉTICOS; nada conecta a banco):
// a pendência que barra o lote (ponto não fechado), o lote gerado com a conta impressa, o arquivo recriado com o mesmo
// SHA-256 (e recusado quando o estado mudou ou o lote foi substituído), o retorno conferido com o resumo e o plano de
// títulos, o retorno divergente que barra os títulos, as recusas antes da conferência (leiaute, campo assistencial,
// competência lançada), a chave desligada, a falta da chave do CPF e o afastamento (registrar, sobrepor, encerrar,
// cancelar, versão) que a exportação leva. Nenhuma resposta nem trilha leva o CPF.
import { createHash } from 'node:crypto';
import { esquemaLoteExportacaoFolha, type LoteRetornoFolha } from '@sgh/contratos';
import { describe, expect, it, vi } from 'vitest';
import { RegistradorTrilhaMemoria } from '../../../autorizacao/trilha.js';
import { ErroProblema } from '../../../problema.filter.js';
import type { SessaoCadastro } from '../../cadastro/comum.js';
import { fonteConfiguracaoMemoria } from '../../config/public-api.js';
import { CifraCpf } from '../cifra-cpf.js';
import type { PortaRealizado } from '../escala/porta-realizado.js';
import type { PortaPonto } from '../ponto/porta-ponto.js';
import { PESSOAS_SINTETICAS_M52, PortaPessoasMemoria } from '../porta-memoria.js';
import { ServicoPessoas } from '../servico.js';
import { PortaFolhaMemoria } from './porta-folha-memoria.js';
import { camposDoRetornoBruto, ServicoFolha, vinculosDoLote } from './servico-folha.js';
import { type ChaveLiberacao, type PrerequisitoRecurso } from '../../config/public-api.js';
import { type EventoDoPeriodo } from '../ponto/tipos-ponto.js';
import { TETO_AFASTAMENTOS, TETO_VINCULOS_FOLHA } from './apoio-folha.js';

const C = PESSOAS_SINTETICAS_M52;
const chave = (c: string): ChaveLiberacao => ({
  id: c,
  tipo: 'recurso',
  chave: c,
  escopo: 'hospital',
  valor: '*',
  ligada: true,
  ligadaAntes: null,
  lote: null,
  justificativa: 'teste sintético',
  alteradoPor: 'SINT.ADMIN',
  alteradoEm: '2026-10-25T10:00:00',
});
const cumprido = (recurso: string): PrerequisitoRecurso => ({
  recurso,
  tipo: 'aprovacao',
  situacao: 'cumprido',
  validade: null,
  evidencia: 'conferência sintética',
  alteradoPor: 'SINT.ADMIN',
  alteradoEm: '2026-10-25T10:00:00',
});
const cifra = new CifraCpf(Buffer.alloc(32, 7));
const COMP = '2026-09';

let k = 0;
function sessao(login = 'SINT.DP.FOLHA', hospital = 'pc'): SessaoCadastro {
  return {
    req: {
      headers: { 'idempotency-key': `m53-folha-${++k}` },
      ip: '127.0.0.1',
      sgh: { sessao: { unidadeAtiva: null } },
    } as never,
    hospital,
    rede: 'rede-sintetica',
    login,
    porta: {
      cliente: hospital,
      estabelecimento: 1,
      usuario: null,
      correlacao: 'teste-folha',
      rede: 'rede-sintetica',
      hospital,
    },
    pode: () => true,
  };
}

/** O ponto e o realizado como a folha os lê (dublês: os fechamentos e os plantões aprovados da competência). */
function dubles() {
  const fechados = new Map<number, Record<string, number>>();
  const plantoes: { vinculo: number; plantao: number; inicio: string; fim: string; minutos: number }[] = [];
  const ponto = {
    eventosDaCompetencia: async (_c: unknown, competencia: string): Promise<EventoDoPeriodo[]> =>
      [...fechados.entries()].map(([vinculo, eventos], i) => ({
        id: 100 + i,
        vinculo,
        competencia,
        acao: 'fechado' as const,
        ref: null,
        hash: null,
        // A apuração grava a classificação por tipo de hora (POTPHORA) ao lado dos eventos; aqui, 1 para 1.
        totais: JSON.stringify({ classes: eventos, eventos }),
        concorda: null,
        texto: null,
        registradoPor: 'SINT.RH',
        registradoEm: '2026-10-01T10:00:00',
      })),
  } as unknown as PortaPonto;
  const realizado = {
    realizadosAprovados: async () => plantoes.map((p, i) => ({ id: i + 1, ...p })),
    plantoesPorIds: async (_c: unknown, ids: readonly number[]) =>
      ids.map((plantao) => ({ plantao, tipo: 'presencial' })),
  } as unknown as PortaRealizado;
  return { fechados, plantoes, ponto, realizado };
}

function montar(ligada = true, comCifra = true) {
  const pessoas = new PortaPessoasMemoria();
  pessoas.hojeFixo = '2026-10-25';
  const trilha = new RegistradorTrilhaMemoria();
  const recursos = ['pessoas.colaborador', ...(ligada ? ['pessoas.folhaExterna'] : [])];
  const config = fonteConfiguracaoMemoria(trilha, {
    chavesIniciais: () => recursos.map(chave),
    prerequisitosIniciais: () => recursos.map(cumprido),
  });
  const rh = new ServicoPessoas(pessoas, trilha, config, null, cifra);
  const porta = new PortaFolhaMemoria(pessoas);
  porta.agoraFixo = '2026-10-25T10:00:00';
  const d = dubles();
  const servico = new ServicoFolha(
    porta,
    pessoas,
    d.ponto,
    d.realizado,
    trilha,
    config,
    null,
    comCifra ? cifra : null,
  );
  return { pessoas, porta, rh, servico, trilha, ...d };
}

async function admitir(rh: ServicoPessoas, admissao = '2026-01-01') {
  return (
    await rh.admitir(sessao('SINT.RH'), {
      cpf: C.nova.cpf,
      nome: 'PESSOA NOVA SINTETICA',
      profissional: null,
      tipo: 'clt',
      admissao,
      cargo: 'Auxiliar administrativo',
      funcao: null,
      cargaSemanalHoras: 44,
      lotacao: { centroCusto: 9521, unidade: 1, setor: 'Posto 3' },
      matricula: null,
      usuario: null,
    })
  ).id;
}

async function codigo(p: Promise<unknown>): Promise<unknown> {
  const e = await p.then(
    () => null,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(ErroProblema);
  return (e as ErroProblema).extras['codigo'] ?? (e as ErroProblema).tipo;
}

function retornoDe(lote: number, vinculo: number, liquido = 250_000): LoteRetornoFolha {
  return {
    leiaute: '1.0',
    loteExportado: lote,
    empresa: 1,
    competencia: COMP,
    recebido: {
      colaboradores: 1,
      afastamentos: 0,
      eventosPonto: 1,
      minutosPonto: 9_600,
      plantoes: 1,
      minutosPlantao: 720,
    },
    colaboradores: [
      {
        vinculo,
        matriculaExterna: 'EXT-1',
        rubricas: [
          { codigo: '001', natureza: 'provento', valor: 300_000 },
          { codigo: '901', natureza: 'desconto', valor: 50_000 },
          { codigo: '999', natureza: 'informativa', valor: 1_000 },
        ],
        liquido,
      },
    ],
    encargos: [
      { tipo: 'inss', valor: 60_000, vencimento: '2026-10-20', centroCusto: null },
      { tipo: 'fgts', valor: 24_000, vencimento: '2026-10-07', centroCusto: 9521 },
    ],
    vencimentoLiquido: '2026-10-05',
    totais: { colaboradores: 1, proventos: 300_000, descontos: 50_000, liquido, encargos: 84_000 },
  };
}

describe('interface com a folha externa (serviço)', () => {
  it('pendência → lote → arquivo com o mesmo SHA-256 → retorno conferido → divergente → substituição', async () => {
    const m = montar();
    const v = await admitir(m.rh);
    const s = sessao();

    // Sem o ponto fechado: pendência, nada gravado.
    const pend = await m.servico.gerarExportacao(s, { empresa: 1, competencia: COMP });
    expect(pend.gerado).toBe(false);
    expect(pend.pendencias).toEqual([{ codigo: 'ponto-nao-fechado', vinculos: [v], valor: 0 }]);
    expect((await m.servico.listarLotes(s, {})).itens).toHaveLength(0);

    // Ponto fechado e um plantão aprovado: o lote sai, com a conta impressa.
    m.fechados.set(v, { '1': 9_600 });
    m.plantoes.push({
      vinculo: v,
      plantao: 77,
      inicio: '2026-09-10T07:00',
      fim: '2026-09-10T19:00',
      minutos: 720,
    });
    const g = await m.servico.gerarExportacao(s, { empresa: 1, competencia: COMP });
    expect(g.gerado).toBe(true);
    expect(g.conta).toBe('1 colaborador; 0 afastamentos; ponto 1 evento = 9.600 min; plantões 1 = 720 min');
    expect(g.lote).toMatchObject({
      sentido: 'exportado',
      situacao: 'gerado',
      colaboradores: 1,
      soma: 10_320,
    });
    const lote = g.lote!.id;

    // O arquivo, recriado, tem o CPF, segue o leiaute e o SHA-256 gravado.
    const a = await m.servico.arquivoLote(s, lote);
    expect(createHash('sha256').update(a.conteudo, 'utf8').digest('hex')).toBe(g.lote!.resumo);
    const arquivo = esquemaLoteExportacaoFolha.parse(JSON.parse(a.conteudo));
    expect(arquivo.colaboradores[0]).toMatchObject({ vinculo: v, cpf: C.nova.cpf, centroCusto: 9521 });
    expect(arquivo.plantoes[0]).toMatchObject({ modalidade: 'presencial', inicio: '2026-09-10T07:00-03:00' });
    expect(arquivo.eventosPonto).toEqual([{ vinculo: v, evento: 1, minutos: 9_600 }]);
    expect(arquivo.horasPonto).toEqual([{ vinculo: v, tipoHora: 1, minutos: 9_600 }]);
    expect(a.nome).toBe(`folha_pc_1_${COMP}_lote${lote}.json`);
    // Nenhuma resposta de lista leva o CPF.
    expect(JSON.stringify(await m.servico.listarLotes(s, {}))).not.toContain(C.nova.cpf);

    // Retorno conferido: o resumo por colaborador e por encargo, e o plano de títulos com as parcelas.
    const ok = await m.servico.importarRetorno(s, lote, retornoDe(lote, v));
    expect(ok.situacao).toBe('conferido');
    expect(ok.divergencias).toEqual([]);
    expect(ok.podeLancar).toBe(true);
    expect(ok.linhasResumo).toBe(5);
    expect(ok.totalTitulos).toBe(334_000);
    expect(ok.contaTitulos).toContain('líquido R$ 2.500,00');
    expect(ok.contaTitulos).toContain('= R$ 3.340,00');
    expect((await m.porta.lote(s.porta, lote))?.situacao).toBe('conferido');
    const resumo = await m.porta.gravarSgh(s.porta, null as never, (x) => x.resumo(ok.lote.id));
    expect(resumo.find((r) => r.rubrica === 'liquido')).toMatchObject({
      vinculo: v,
      centroCusto: 9521,
      valor: 250_000,
    });

    // Retorno com o líquido alterado: divergente, sem resumo, e o recebido anterior é substituído.
    const div = await m.servico.importarRetorno(s, lote, retornoDe(lote, v, 240_000));
    expect(div.situacao).toBe('divergente');
    expect(div.podeLancar).toBe(false);
    expect(div.linhasResumo).toBe(0);
    expect(div.divergencias.map((d) => d.codigo)).toContain('liquido-colaborador');
    expect((await m.porta.lote(s.porta, ok.lote.id))?.situacao).toBe('substituido');

    // Estado mudou depois da geração (ponto reaberto e fechado com outros minutos): o arquivo é recusado.
    m.fechados.set(v, { '1': 9_000 });
    expect(await codigo(m.servico.arquivoLote(s, lote))).toBe('lote-desatualizado');

    // Lote novo da mesma competência substitui o anterior; o arquivo e o retorno do antigo são recusados.
    const g2 = await m.servico.gerarExportacao(s, { empresa: 1, competencia: COMP });
    expect(g2.substituido).toBe(lote);
    expect(await codigo(m.servico.arquivoLote(s, lote))).toBe('lote-substituido');
    expect(await codigo(m.servico.importarRetorno(s, lote, retornoDe(lote, v)))).toBe('lote-substituido');

    // A trilha não leva o CPF.
    expect(JSON.stringify(m.trilha)).not.toContain(C.nova.cpf);
  });

  it('recusas do retorno antes da conferência e da geração', async () => {
    const m = montar();
    const v = await admitir(m.rh);
    const s = sessao();
    m.fechados.set(v, { '1': 60 });
    const g = await m.servico.gerarExportacao(s, { empresa: 1, competencia: COMP });
    const lote = g.lote!.id;
    expect(await codigo(m.servico.importarRetorno(s, lote, { ...retornoDe(lote, v), leiaute: '2.0' }))).toBe(
      'leiaute',
    );
    const r = retornoDe(lote, v);
    const comConselho = {
      ...r,
      colaboradores: [{ ...r.colaboradores[0], conselho: { sigla: 'CRM', numero: '1', uf: 'SP' } }],
    };
    expect(await codigo(m.servico.importarRetorno(s, lote, comConselho))).toBe('campo-assistencial');
    expect(await codigo(m.servico.importarRetorno(s, lote, { ...r, totais: 'x' }))).toBe('arquivo-invalido');
    expect(await codigo(m.servico.importarRetorno(s, 99_999, retornoDe(99_999, v)))).toBe('lote-inexistente');
    // Empresa desconhecida, competência futura e sem colaboradores.
    expect(await codigo(m.servico.gerarExportacao(s, { empresa: 9, competencia: COMP }))).toBe(
      'nao-encontrado',
    );
    const fut = await m.servico.gerarExportacao(s, { empresa: 1, competencia: '2026-12' });
    expect(fut.pendencias.map((p) => p.codigo)).toContain('competencia-futura');
    const vazio = await m.servico.gerarExportacao(s, { empresa: 1, competencia: '2025-06' });
    expect(vazio.pendencias.map((p) => p.codigo)).toContain('sem-colaboradores');
  });

  it('chave desligada e sem a chave do CPF', async () => {
    const desligada = montar(false);
    const s = sessao();
    expect(await codigo(desligada.servico.gerarExportacao(s, { empresa: 1, competencia: COMP }))).toBe(
      'recurso-desligado',
    );
    expect(await codigo(desligada.servico.arquivoLote(s, 1))).toBe('recurso-desligado');
    const apoio = await desligada.servico.apoioTela(s);
    expect(apoio.gravacao.ligada).toBe(false);
    expect(apoio.acoes.exportar).toBe(false);
    expect(apoio.competenciaSugerida).toBe('2026-09');
    expect(apoio.empresas).toHaveLength(1);
    const semCifra = montar(true, false);
    expect(await codigo(semCifra.servico.gerarExportacao(s, { empresa: 1, competencia: COMP }))).toBe(
      'sem-chave-cpf',
    );
    expect(await codigo(semCifra.servico.arquivoLote(s, 1))).toBe('sem-chave-cpf');
  });

  it('acima do teto de colaboradores ou de afastamentos: recusa, nunca um lote cortado', async () => {
    const m = montar();
    const s = sessao();
    const v = await admitir(m.rh);
    m.fechados.set(v, { '1': 60 });
    const [um] = await m.porta.vinculosDaFolha(s.porta, '2026-09-01', '2026-09-30');
    expect(um).toBeDefined();
    const muitos = vi
      .spyOn(m.porta, 'vinculosDaFolha')
      .mockResolvedValue(Array.from({ length: TETO_VINCULOS_FOLHA + 1 }, () => um!));
    expect(await codigo(m.servico.gerarExportacao(s, { empresa: 1, competencia: COMP }))).toBe(
      'acima-do-teto',
    );
    muitos.mockRestore();
    const af = vi
      .spyOn(m.porta, 'afastamentos')
      .mockResolvedValue(new Array(TETO_AFASTAMENTOS + 1).fill({}) as never);
    expect(await codigo(m.servico.gerarExportacao(s, { empresa: 1, competencia: COMP }))).toBe(
      'acima-do-teto',
    );
    af.mockRestore();
    expect((await m.servico.gerarExportacao(s, { empresa: 1, competencia: COMP })).gerado).toBe(true);
  });

  it('afastamento: registrar, sobrepor, encerrar, cancelar, versão; a exportação leva o em vigor', async () => {
    const m = montar();
    const v = await admitir(m.rh);
    const s = sessao();
    const r = await m.servico.registrarAfastamento(s, {
      vinculo: v,
      motivo: 1,
      inicio: '2026-09-05',
      fim: null,
      observacao: null,
    });
    expect(r.ok).toBe(true);
    expect(
      await codigo(
        m.servico.registrarAfastamento(s, {
          vinculo: v,
          motivo: 3,
          inicio: '2026-09-10',
          fim: '2026-09-12',
          observacao: null,
        }),
      ),
    ).toBe('sobreposto');
    expect(
      await codigo(
        m.servico.registrarAfastamento(s, {
          vinculo: v,
          motivo: 42,
          inicio: '2026-11-10',
          fim: null,
          observacao: null,
        }),
      ),
    ).toBe('motivo-inexistente');
    expect(
      await codigo(
        m.servico.registrarAfastamento(s, {
          vinculo: 99_999,
          motivo: 1,
          inicio: '2026-11-10',
          fim: null,
          observacao: null,
        }),
      ),
    ).toBe('nao-encontrado');
    const lista = await m.servico.listarAfastamentos(s, { competencia: COMP });
    expect(lista.itens).toHaveLength(1);
    expect(lista.itens[0]).toMatchObject({
      vinculo: v,
      motivoRotulo: 'Doença (até 15 dias)',
      situacao: 'ativo',
    });
    const versao = lista.itens[0]!.versao;
    expect(
      await codigo(
        m.servico.alterarAfastamento(s, r.id, {
          versao: versao + 9,
          acao: 'encerrar',
          fim: '2026-09-14',
          motivo: null,
        }),
      ),
    ).toBe('desatualizado');
    await m.servico.alterarAfastamento(s, r.id, {
      versao,
      acao: 'encerrar',
      fim: '2026-09-14',
      motivo: null,
    });

    m.fechados.set(v, { '1': 60 });
    const g = await m.servico.gerarExportacao(s, { empresa: 1, competencia: COMP });
    const arq = esquemaLoteExportacaoFolha.parse(
      JSON.parse((await m.servico.arquivoLote(s, g.lote!.id)).conteudo),
    );
    expect(arq.afastamentos).toEqual([{ vinculo: v, motivo: 1, inicio: '2026-09-05', fim: '2026-09-14' }]);

    const atual = (await m.servico.listarAfastamentos(s, { vinculo: v })).itens[0]!;
    expect(
      await codigo(
        m.servico.alterarAfastamento(s, r.id, {
          versao: atual.versao,
          acao: 'encerrar',
          fim: '2026-09-20',
          motivo: null,
        }),
      ),
    ).toBe('ja-encerrado');
    await m.servico.alterarAfastamento(s, r.id, {
      versao: atual.versao,
      acao: 'cancelar',
      fim: null,
      motivo: 'lançado em duplicidade',
    });
    const cancelado = (await m.servico.listarAfastamentos(s, { vinculo: v })).itens[0]!;
    expect(cancelado.situacao).toBe('cancelado');
    expect(
      await codigo(
        m.servico.alterarAfastamento(s, r.id, {
          versao: cancelado.versao,
          acao: 'cancelar',
          fim: null,
          motivo: 'x',
        }),
      ),
    ).toBe('cancelado');
  });

  it('auxiliares: vínculos do lote e campos do retorno bruto', () => {
    expect(vinculosDoLote('[[5,9521],[7,null]]')).toEqual([
      { vinculo: 5, centroCusto: 9521 },
      { vinculo: 7, centroCusto: null },
    ]);
    expect(vinculosDoLote('[3]')).toEqual([{ vinculo: 3, centroCusto: null }]);
    expect(vinculosDoLote('x')).toEqual([]);
    expect(vinculosDoLote(null)).toEqual([]);
    expect(
      camposDoRetornoBruto({ colaboradores: [{ liquido: 1, conselho: {}, ponto: 1, outro: 2 }] }),
    ).toEqual(['conselho', 'liquido', 'ponto']);
    expect(camposDoRetornoBruto(null)).toEqual([]);
  });
});
