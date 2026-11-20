// M53.7: o fechamento do período da folha sobre as portas EM MEMÓRIA (dados SINTÉTICOS; nada conecta a banco): a prévia
// com as pendências e a prova da soma, o fechamento com os processamentos fixados e a soma de verificação, o período
// fechado que recusa novo cálculo e descarte (a mesma conferência do gravador do legado), o líquido do recibo de um
// colaborador só omitido sem `pessoas.salario.ler`, a reabertura com motivo (e recusada com o eSocial do período fechado)
// e a chave desligada.
import type { TotaisCalculoFolha } from '@sgh/contratos';
import type { ChaveGravada, PrerequisitoGravado } from '@sgh/legado';
import { describe, expect, it } from 'vitest';
import { RegistradorTrilhaMemoria } from '../../../autorizacao/trilha.js';
import { ErroProblema } from '../../../problema.filter.js';
import type { SessaoCadastro } from '../../cadastro/comum.js';
import { fonteConfiguracaoMemoria } from '../../config/public-api.js';
import { PortaEsocialMemoria } from '../esocial/porta-esocial-memoria.js';
import { PortaPessoasMemoria } from '../porta-memoria.js';
import { PortaCalculoFolhaMemoria } from './porta-calculo-memoria.js';
import { PortaFolhaMemoria } from './porta-folha-memoria.js';
import { intervaloDoPeriodo, ServicoFechamentoFolha } from './servico-fechamento.js';

const CTX = { rede: 'rede-sintetica', hospital: 'pc' };
const chave = (c: string): ChaveGravada => ({
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
const cumprido = (recurso: string): PrerequisitoGravado => ({
  recurso,
  tipo: 'aprovacao',
  situacao: 'cumprido',
  validade: null,
  evidencia: 'conferência sintética',
  alteradoPor: 'SINT.ADMIN',
  alteradoEm: '2026-10-25T10:00:00',
});
let k = 0;
function sessao(pode: (p: string) => boolean = () => true): SessaoCadastro {
  return {
    req: {
      headers: { 'idempotency-key': `m53-fechamento-${++k}` },
      ip: '127.0.0.1',
      sgh: { sessao: { unidadeAtiva: null } },
    } as never,
    hospital: 'pc',
    rede: 'rede-sintetica',
    login: 'SINT.DP.FOLHA',
    porta: CTX,
    pode,
  };
}
async function codigo(p: Promise<unknown>): Promise<unknown> {
  const e = await p.then(
    () => null,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(ErroProblema);
  return (e as ErroProblema).extras['codigo'] ?? (e as ErroProblema).tipo;
}

const totais = (liquido: number): TotaisCalculoFolha => ({
  colaboradores: 1,
  proventos: liquido + 10_000,
  descontos: 10_000,
  liquido,
  inss: 8_000,
  irrf: 2_000,
  fgts: 8_000,
  inssPatronal: 20_000,
  rat: 3_000,
  terceiros: 5_800,
});

function montar(chaves: readonly string[] = ['pessoas.folha']) {
  const pessoas = new PortaPessoasMemoria();
  const trilha = new RegistradorTrilhaMemoria();
  const config = fonteConfiguracaoMemoria(trilha, {
    chavesIniciais: () => chaves.map(chave),
    prerequisitosIniciais: () => chaves.map(cumprido),
  });
  const folha = new PortaFolhaMemoria(pessoas);
  folha.agoraFixo = '2026-10-28T10:00:00';
  const porta = new PortaCalculoFolhaMemoria(pessoas);
  porta.agoraFixo = '2026-10-28T10:00:00';
  const esocial = new PortaEsocialMemoria();
  const servico = new ServicoFechamentoFolha(porta, folha, esocial, trilha, config, null);
  const processo = (
    tipo: 'mensal' | 'ferias' | 'decimo2',
    competencia: string,
    liquido: number,
    pagamento: string | null = null,
  ) =>
    porta.gravarSgh(CTX, {} as never, (g) =>
      g.incluirProcesso({
        empresa: 1,
        competencia,
        tipo,
        pagamento,
        numero: 1,
        totais: totais(liquido),
        foraDaFolha: 0,
        tabelaLegal: '2026-01-01',
        parametros: '2026-01-01',
        resumo: String(liquido).padStart(64, '0'),
        por: 'SINT',
      }),
    );
  return { porta, folha, esocial, servico, trilha, processo };
}

const MENSAL = { empresa: 1, apuracao: 'mensal' as const, periodo: '2026-09', pagamento: '2026-10-05' };

describe('fechamento do período da folha (serviço)', () => {
  it('intervalo das competências do período', () => {
    expect(intervaloDoPeriodo('mensal', '2026-09')).toEqual({ de: '2026-09', ate: '2026-09' });
    expect(intervaloDoPeriodo('anual', '2026')).toEqual({ de: '2026-01', ate: '2026-12' });
  });

  it('prévia: sem folha mensal e sem data, pendências; não grava', async () => {
    const m = montar();
    const r = await m.servico.fechar(sessao(), { ...MENSAL, pagamento: null, simular: true });
    expect(r).toMatchObject({ fechado: false, simulado: true, fechamento: null });
    expect(r.pendencias.map((p) => p.codigo)).toEqual(['sem-folha-mensal', 'pagamento-obrigatorio']);
    expect(await codigo(m.servico.fechar(sessao(), { ...MENSAL, simular: false }))).toBe(
      'fechamento-com-pendencias',
    );
    expect((await m.servico.listar(sessao(), {})).itens).toEqual([]);
  });

  it('fecha o mensal com a folha e o recibo de férias, a prova da soma e a soma de verificação; período fechado barra cálculo e descarte', async () => {
    const m = montar();
    const idMensal = await m.processo('mensal', '2026-09', 500_000);
    await m.processo('ferias', '2026-09', 120_000, '2026-09-01');
    await m.processo('mensal', '2026-10', 1);
    const previa = await m.servico.fechar(sessao(), { ...MENSAL, simular: true });
    expect(previa.pendencias).toEqual([]);
    expect(previa.totais).toMatchObject({ processos: 2, liquido: 620_000, encargos: 57_600 });
    expect(previa.conferencia.ok).toBe(true);
    expect(previa.processos.map((p) => [p.tipo, p.pagamento, p.liquido])).toEqual([
      ['mensal', '2026-10-05', 500_000],
      ['ferias', '2026-09-01', 120_000],
    ]);
    const r = await m.servico.fechar(sessao(), { ...MENSAL, simular: false });
    expect(r.fechado).toBe(true);
    expect(r.fechamento).toMatchObject({
      empresa: 1,
      apuracao: 'mensal',
      periodo: '2026-09',
      numero: 1,
      situacao: 'fechada',
      pagamento: '2026-10-05',
      fechadoPor: 'SINT.DP.FOLHA',
    });
    expect(r.fechamento!.resumo).toMatch(/^[0-9a-f]{64}$/);
    expect(m.trilha.eventos.some((l) => l.evento === 'pessoas.folha.fechada')).toBe(true);
    // Fechado: novo fechamento recusado; o gravador recusa incluir e descartar no período.
    expect(await codigo(m.servico.fechar(sessao(), { ...MENSAL, simular: false }))).toBe(
      'fechamento-com-pendencias',
    );
    expect(await codigo(m.processo('mensal', '2026-09', 1).catch((e) => Promise.reject(asProblema(e))))).toBe(
      'competencia-fechada',
    );
    const descarte = m.porta.gravarSgh(CTX, {} as never, (g) =>
      g.situacaoProcesso({
        id: idMensal,
        versao: 0,
        de: 'calculada',
        para: 'descartada',
        motivo: 'x',
        por: 'y',
      }),
    );
    expect(await codigo(descarte.catch((e) => Promise.reject(asProblema(e))))).toBe('competencia-fechada');
    // Outra competência segue aberta.
    expect((await m.processo('ferias', '2026-10', 5, '2026-10-01')) > 0).toBe(true);
  });

  it('sem pessoas.salario.ler o líquido do recibo de férias sai nulo e a prova mostra só os totais', async () => {
    const m = montar();
    await m.processo('mensal', '2026-09', 500_000);
    await m.processo('ferias', '2026-09', 120_000, '2026-09-01');
    const s = sessao((p) => p !== 'pessoas.salario.ler');
    const previa = await m.servico.fechar(s, { ...MENSAL, simular: true });
    expect(previa.processos.map((p) => p.liquido)).toEqual([500_000, null]);
    expect(previa.conferencia.parcelas.map((p) => p.rotulo)).toEqual([
      'Proventos',
      'Descontos',
      'Líquido (proventos − descontos)',
    ]);
    await m.servico.fechar(sessao(), { ...MENSAL, simular: false });
    const [f] = (await m.servico.listar(s, { empresa: 1, ano: '2026' })).itens;
    expect(f!.processos.map((p) => p.liquido)).toEqual([500_000, null]);
    expect((await m.servico.detalhe(sessao(), f!.id)).processos.map((p) => p.liquido)).toEqual([
      500_000, 120_000,
    ]);
    expect(await codigo(m.servico.detalhe(sessao(), 999))).toBe('nao-encontrado');
  });

  it('anual: fecha com a 2ª parcela do 13º e sem data de pagamento da folha', async () => {
    const m = montar();
    m.folha.agoraFixo = '2026-12-21T10:00:00';
    expect(
      (
        await m.servico.fechar(sessao(), {
          empresa: 1,
          apuracao: 'anual',
          periodo: '2026',
          pagamento: null,
          simular: true,
        })
      ).pendencias.map((p) => p.codigo),
    ).toEqual(['sem-decimo-final']);
    await m.processo('decimo2', '2026-12', 300_000, '2026-12-18');
    const r = await m.servico.fechar(sessao(), {
      empresa: 1,
      apuracao: 'anual',
      periodo: '2026',
      pagamento: '2026-12-18',
      simular: false,
    });
    expect(r.fechamento).toMatchObject({ apuracao: 'anual', periodo: '2026', pagamento: null });
  });

  it('reabre com motivo (versão); o eSocial do período fechado recusa a reabertura; reabrir de novo é recusado', async () => {
    const m = montar();
    await m.processo('mensal', '2026-09', 500_000);
    const f = (await m.servico.fechar(sessao(), { ...MENSAL, simular: false })).fechamento!;
    // Um S-1299 aceito no período fecha o eSocial.
    await m.esocial.gravarSgh(CTX, {} as never, async (g) => {
      const id = await g.proximoIdEvento();
      await g.incluirEvento(id, {
        empresa: 1,
        evento: 'S-1299',
        grupo: 'periodico',
        operacao: null,
        idEsocial: `ID1112223330000002026102810000000${String(id).padStart(3, '0')}`.slice(0, 36),
        vinculo: null,
        origem: 'fechamento-periodo',
        referencia: 1,
        dataReferencia: '2026-09',
        leiaute: 'v_S_01_03_00',
        xml: '<x/>',
        xmlCifrado: false,
        hashXml: 'a'.repeat(64),
        errosXsd: [],
        situacao: 'validado',
        eventoAnterior: null,
        por: 'SINT',
      });
      return id;
    });
    expect(
      await codigo(m.servico.reabrir(sessao(), f.id, { versao: 0, motivo: 'Correção das férias' })),
    ).toBe('esocial-fechado');
    const m2 = montar();
    await m2.processo('mensal', '2026-09', 500_000);
    const f2 = (await m2.servico.fechar(sessao(), { ...MENSAL, simular: false })).fechamento!;
    expect(
      await codigo(m2.servico.reabrir(sessao(), f2.id, { versao: 7, motivo: 'Correção das férias' })),
    ).toBe('desatualizado');
    const r = await m2.servico.reabrir(sessao(), f2.id, { versao: 0, motivo: 'Correção das férias' });
    expect(r).toMatchObject({
      situacao: 'reaberta',
      motivo: 'Correção das férias',
      reabertoPor: 'SINT.DP.FOLHA',
    });
    expect(
      await codigo(m2.servico.reabrir(sessao(), f2.id, { versao: 1, motivo: 'De novo, sem razão' })),
    ).toBe('periodo-nao-fechado');
    expect(await codigo(m2.servico.reabrir(sessao(), 999, { versao: 0, motivo: 'Correção x' }))).toBe(
      'nao-encontrado',
    );
    // Reaberto, o período fecha de novo com o número seguinte.
    const de2 = await m2.servico.fechar(sessao(), { ...MENSAL, simular: false });
    expect(de2.fechamento).toMatchObject({ numero: 2, situacao: 'fechada' });
  });

  it('chave da folha desligada: a prévia sai, fechar e reabrir são recusados; empresa fora do cadastro', async () => {
    const m = montar([]);
    await m.processo('mensal', '2026-09', 500_000);
    expect((await m.servico.fechar(sessao(), { ...MENSAL, simular: true })).pendencias).toEqual([]);
    expect(await codigo(m.servico.fechar(sessao(), { ...MENSAL, simular: false }))).toBe('recurso-desligado');
    expect(await codigo(m.servico.reabrir(sessao(), 1, { versao: 0, motivo: 'Correção x' }))).toBe(
      'recurso-desligado',
    );
    expect(await codigo(m.servico.fechar(sessao(), { ...MENSAL, empresa: 9, simular: true }))).toBe(
      'nao-encontrado',
    );
  });
});

/** O erro da porta em memória (ErroOperacao) como o problema que a API devolve. */
function asProblema(e: unknown): ErroProblema {
  const x = e as { problema?: { codigo?: string; titulo?: string; detalhe?: string } };
  return new ErroProblema('recusa-de-negocio', 409, 'x', 'x', { codigo: x.problema?.codigo ?? 'outro' });
}
