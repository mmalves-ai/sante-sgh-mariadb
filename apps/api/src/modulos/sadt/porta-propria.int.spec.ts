// Integração da porta própria do SADT contra o MariaDB real (cliente f22_o2; massa SINTÉTICA, nenhuma pessoa real).
// Leituras: a lista do setor com filtro e contagens, o exame e o estado derivado, o isolamento por estabelecimento, os
// analitos do exame e a liberação vigente. Contrato de efeito: o laudo emitido (emissão, exames, número de negócio, o
// item marcado como emitido e a trilha), a validação pública pelo código, a segunda via com motivo e a leitura do
// resultado registrada. Pendências: as leituras ainda sem modelo respondem 409 com o motivo.
import { ErroOperacao, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CLIENTE,
  contexto,
  limparMassaSadt,
  linhaTela,
  type MassaSadt,
  montarMassaSadt,
  SEM_BANCO,
} from './aplicacao/copia.spec-util.js';
import { LEITURAS_PENDENTES, PortaSadtPropria } from './porta-propria.js';

const codigoDe = (e: unknown) => (e instanceof ErroOperacao ? String(e.problema['codigo'] ?? '') : String(e));

describe.skipIf(SEM_BANCO)('porta própria do SADT (MariaDB, cliente f22_o2)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaSadtPropria;
  let m: MassaSadt | null = null;
  const um = (sql: string, p: unknown[]) => nucleo.lerSomente({ cliente: CLIENTE, correlacao: 't-s09por' }, (l) => l.uma(sql, p));

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await montarMassaSadt(nucleo, 'S9P');
    porta = new PortaSadtPropria(nucleo);
  }, 60_000);
  afterAll(async () => {
    await limparMassaSadt(nucleo, m);
    await nucleo.encerrar();
  });

  it('lista do setor, filtros, contagens, exame e isolamento por estabelecimento', async () => {
    const c = contexto(m!);
    const { hoje } = await porta.relogio(c);
    const lab = await porta.examesDoSetor(c, { setor: 'laboratorio', inicio: hoje, fim: hoje });
    expect(lab.itens.map((x) => x.id).sort()).toEqual([m!.itemLab, m!.itemLab2, m!.itemLiberado].sort());
    expect(lab.contagens).toMatchObject({ solicitado: 2, liberado: 1 });
    const aReceber = await porta.examesDoSetor(c, { setor: 'laboratorio', inicio: hoje, fim: hoje, situacao: 'aReceber' });
    expect(aReceber.itens).toHaveLength(2);
    const imagem = await porta.examesDoSetor(c, { setor: 'imagem', inicio: hoje, fim: hoje, ato: 25 });
    expect(imagem.itens.map((x) => x.id)).toEqual([m!.itemImagem]);
    expect(imagem.itens[0]).toMatchObject({ setor: 'imagem', ato: 25, exame: { codigo: `${m!.marca}T` } });
    const x = await porta.exame(c, m!.itemLiberado);
    expect(x).toMatchObject({
      estado: 'liberado',
      critico: true,
      origem: 'pedidoProntuario',
      paciente: { id: m!.base.paciente },
      chave: { conta: m!.requisicao, sequencia: 3, ato: 15 },
    });
    expect(x!.versao).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
    expect(await porta.exame(contexto(m!, m!.base.outroEst), m!.itemLab)).toBeNull();
    expect(await porta.elementos(c, m!.exameLabCodigo)).toEqual([{ codigo: m!.analito, nome: 'POTASSIO', unidade: null }]);
    expect(await porta.liberacaoVigente(c, m!.itemLiberado)).toMatchObject({ id: m!.resultado, visualizada: false });
    expect(await porta.liberacaoVigente(c, m!.itemLab)).toBeNull();
    expect(await porta.pacienteDoAtendimento(c, m!.base.atendimento)).toMatchObject({ paciente: m!.base.paciente });
    const coleta = await porta.coleta(c, { inicio: hoje, fim: hoje });
    expect(coleta.grupos).toHaveLength(1);
    expect(coleta.grupos[0]!.exames).toHaveLength(2);
  });

  it('laudo emitido, validação pública, segunda via com motivo e leitura do resultado', async () => {
    const c = contexto(m!);
    // Cada emissão (a segunda via também) tem o seu código de autenticação (único no banco).
    const cod1 = `${m!.marca}A1B2C3D4E5`.slice(0, 16);
    const cod2 = `${m!.marca}Z9Y8X7W6V5`.slice(0, 16);
    const emitir = (via: number, motivo: string | null) =>
      porta.gravarSgh(c, (id: number) => linhaTela(m!, 'sadt.laudo.emitido', 'emissao_laudo', id), (g) =>
        g.registrarLaudoEmitido({
          impressao: 0,
          codigo: via > 1 ? cod2 : cod1,
          via,
          exames: 1,
          hashPdf: null,
          motivo,
          usuario: m!.base.login,
          idsExames: [m!.itemLiberado],
        }),
      );
    const id = await emitir(1, null);
    expect(await um('SELECT numero, tipo_emissao, versao FROM emissao_laudo WHERE id = ?', [id])).toMatchObject({
      tipo_emissao: 'pdf',
      versao: 1,
    });
    expect(await um('SELECT emitido_em IS NOT NULL AS e, versao FROM exame_item WHERE id = ?', [m!.itemLiberado])).toMatchObject({
      e: 1,
      versao: 2,
    });
    expect(
      Number((await um("SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'emissao_laudo' AND entidade_id = ?", [id]))?.['n']),
    ).toBe(1);
    expect(await porta.validarLaudo(c, cod1)).toMatchObject({ valido: true, exames: 1 });
    expect(await porta.validarLaudo(c, 'NAOEXISTE')).toMatchObject({ valido: false });
    expect(await porta.impressaoDosExames(c, [m!.itemLiberado])).toMatchObject({ impressao: id });
    expect(codigoDe(await emitir(2, null).catch((e: unknown) => e))).toBe('motivo-obrigatorio');
    expect(codigoDe(await emitir(2, 'motivo livre qualquer').catch((e: unknown) => e))).toBe('motivo-nao-cadastrado');
    await emitir(2, 'Paciente perdeu a primeira via');
    expect(await porta.laudosDoExame(c, m!.itemLiberado)).toMatchObject([{ codigo: cod1, segundasVias: 1 }]);
    expect((await porta.exame(c, m!.itemLiberado))?.estado).toBe('emitido');

    const ler = (origem: 'pep' | 'portal') =>
      porta.gravarSgh(c, linhaTela(m!, 'sadt.resultado.lido', 'visualizacao_resultado_exame', null), (g) =>
        g.registrarLeitura({ exameItem: m!.itemLiberado, origem, usuario: m!.base.login }),
      );
    await ler('pep');
    // A segunda abertura do mesmo usuário não grava de novo (nem estoura a chave única).
    await ler('pep');
    expect(
      Number((await um('SELECT COUNT(*) AS n FROM visualizacao_resultado_exame WHERE resultado_exame_id = ?', [m!.resultado]))?.['n']),
    ).toBe(1);
    // A leitura no portal não tem usuário interno: recusa explícita (vai com a operação de visualização no portal).
    expect(codigoDe(await ler('portal').catch((x: unknown) => x))).toBe('modelo-pendente');
    expect(await porta.liberacaoVigente(c, m!.itemLiberado)).toMatchObject({ visualizada: true });
    expect((await porta.exame(c, m!.itemLiberado))?.estado).toBe('visualizado');
  });

  it('leituras sem modelo: 409 com o motivo (nada em silêncio)', async () => {
    const c = contexto(m!);
    const e = await porta.digitacao().catch((x: unknown) => x);
    expect((e as ErroOperacao).problema).toMatchObject({ status: 409, codigo: 'modelo-pendente' });
    expect(String((e as ErroOperacao).problema['detail'])).toContain(LEITURAS_PENDENTES['digitacao']!.slice(1, 20));
    expect(codigoDe(await porta.gravarSgh(c, linhaTela(m!, 'x', 'x', null), (g) => g.registrarOrcamento({} as never)).catch((x: unknown) => x))).toBe(
      'modelo-pendente',
    );
  });
});
