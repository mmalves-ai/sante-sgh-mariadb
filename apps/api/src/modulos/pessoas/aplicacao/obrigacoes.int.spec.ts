// FGTS Digital e obrigações legais (M53.8, fatia F7; ficha do M53, seções 6 a 8; regras 3 e 7) sobre a cópia (transação
// DESFEITA): um colaborador sintético admitido no mês, com a ficha cifrada (com o NIS) e a folha mensal de 2009-09
// gravada pelo gravador do cálculo; o fechamento do período; os parâmetros das obrigações por empresa (SGH_PES_OBRIGACAO_
// PARAM, do 0999) com os regimes sintéticos que exigem tudo em 2009 (DP-47: os marcos legais são dado); a apuração do
// FGTS Digital barrada pelo S-1200 ainda não aceito, liberada depois do retorno aceito, gerada e entregue com a guia
// conciliada; a SEFIP gerada no leiaute de 360 posições (arquivo cifrado relido e conferido pelo SHA-256), recusada na
// entrega com o leiaute não conferido e cancelada; o CAGED com a admissão do mês; a RAIS barrada pelo ano não fechado.
// Antes e depois, as tabelas de folha e de eSocial do outro sistema têm a mesma contagem. Só contagens, formatos e
// códigos no que se afirma; nenhum dado real impresso.
import { randomBytes } from 'node:crypto';
import type { FichaEsocialVinculo, ParametrosObrigacoes } from '@sgh/contratos';
import {
  type ChaveGravada,
  incluirLinhasCalculoPesSgh,
  incluirProcessoFolhaPesSgh,
  incluirVinculoPesSgh,
  type PrerequisitoGravado,
  somenteSgh,
} from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RegistradorTrilhaMemoria } from '../../../autorizacao/trilha.js';
import { type AmbienteM27, ambienteM27, PODE_ESCREVER } from '../../acesso/aplicacao/copia.spec-util.js';
import type { SessaoCadastro } from '../../cadastro/comum.js';
import { fonteConfiguracaoMemoria } from '../../config/public-api.js';
import { CifraCpf } from '../cifra-cpf.js';
import { portaEsocialNaTransacao } from '../esocial/porta-esocial-legado.js';
import { ServicoEsocial } from '../esocial/servico-esocial.js';
import { ServicoPeriodicosEsocial } from '../esocial/servico-periodicos.js';
import { portaCalculoFolhaNaTransacao } from '../folha/porta-calculo-legado.js';
import { portaFolhaNaTransacao } from '../folha/porta-folha-legado.js';
import { ServicoFechamentoFolha } from '../folha/servico-fechamento.js';
import { ServicoObrigacoes } from '../obrigacoes/servico-obrigacoes.js';
import { portaPessoasNaTransacao } from '../porta-legado.js';
import { portaRubricasNaTransacao } from '../rubricas/porta-rubricas-legado.js';

const chave = (c: string): ChaveGravada => ({
  id: c,
  tipo: 'recurso',
  chave: c,
  escopo: 'hospital',
  valor: '*',
  ligada: true,
  ligadaAntes: null,
  lote: null,
  justificativa: 'integração sintética',
  alteradoPor: 'SGH.TESTE',
  alteradoEm: '2026-10-28T10:00:00',
});
const cumprido = (recurso: string): PrerequisitoGravado => ({
  recurso,
  tipo: 'aprovacao',
  situacao: 'cumprido',
  validade: null,
  evidencia: 'integração sintética',
  alteradoPor: 'SGH.TESTE',
  alteradoEm: '2026-10-28T10:00:00',
});
const n = (v: unknown) => Number(v ?? 0);
const LEGADAS = ['FPESOCPEND', 'FPESOCPENDDET', 'FPFUNC', 'FPCABECFOLHA', 'FPFICHAF'] as const;
/** CPF e NIS sintéticos com dígitos válidos (não são de pessoa real). */
const CPF = '52998224725';
const NIS = '12345678900';
/** Competência sintética longe de qualquer dado real (nada do Sante SGH tem esta competência). */
const COMP = '2009-09';
/** O código da recusa: a do gravador (`problema.codigo`) ou a do serviço (`extras.codigo`). */
const codigoDe = (x: unknown) => {
  const e = x as { problema?: { codigo?: string }; extras?: { codigo?: string } };
  return e.problema?.codigo ?? e.extras?.codigo ?? String(x);
};

const FICHA: FichaEsocialVinculo = {
  sexo: 'F',
  racaCor: 6,
  estadoCivil: null,
  grauInstrucao: '07',
  nomeSocial: null,
  nascimento: '1970-01-01',
  paisNascimento: '105',
  paisNacionalidade: '105',
  endereco: {
    tipoLogradouro: null,
    logradouro: 'Rua Sintética',
    numero: '1',
    complemento: null,
    bairro: null,
    cep: '00000000',
    municipio: '3106200',
    uf: 'MG',
  },
  categoria: '101',
  cboCargo: '411005',
  cboFuncao: null,
  regimeJornada: 1,
  naturezaAtividade: 1,
  tipoContrato: 1,
  terminoContrato: null,
  tipoJornada: 2,
  tempoParcial: 0,
  descricaoJornada: 'Jornada sintética da integração',
  tipoAdmissao: 1,
  indicativoAdmissao: 1,
  cnpjSindicato: '33444555000106',
  estagio: null,
  nis: NIS,
};

const regime = (leiaute: string, leiauteConferido: boolean) => ({
  exigidaDe: null,
  exigidaAte: null,
  leiaute,
  leiauteConferido,
});
const parametros = (empresa: number): ParametrosObrigacoes => ({
  empresa,
  inicio: '2009-01',
  razaoSocial: 'EMPRESA SINTETICA DA INTEGRACAO',
  endereco: {
    logradouro: 'RUA SINTETICA 1',
    bairro: 'CENTRO',
    cep: '30000000',
    cidade: 'BELO HORIZONTE',
    uf: 'MG',
    municipio: '3106200',
  },
  contato: { nome: 'RESPONSAVEL SINT', telefone: '3130000000', email: 'dp@exemplo.invalid' },
  naturezaJuridica: '2062',
  codigoRecolhimentoSefip: '115',
  codigoPagamentoGps: '2100',
  // Regimes sintéticos: tudo exigido em 2009 (os marcos legais reais ficam na sugestão; aqui só se prova a leitura).
  regimes: {
    'fgts-digital': regime('FGTS Digital 1.0', true),
    sefip: regime('SEFIP 8.4', false),
    caged: regime('CAGED 2010', false),
    rais: regime('RAIS 2018', false),
  },
});

describe.skipIf(!PODE_ESCREVER)('FGTS Digital e obrigações legais (cópia, transação desfeita)', () => {
  let a: AmbienteM27;
  beforeAll(async () => {
    a = await ambienteM27();
  }, 900_000);
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  it('parâmetros → FGTS Digital (barrado sem S-1200 aceito, gerado e entregue) → SEFIP → CAGED → RAIS; outro sistema intacto', async () => {
    const r = await a.nucleo.desfazendoNaCopia({ ...a.c, traceId: 'int-m538-obrigacoes' }, async (e) => {
      const contar = async () => {
        const out: Record<string, number> = {};
        for (const t of LEGADAS)
          out[t] = n((await e.consultar(`SELECT COUNT(*) Q FROM ${t}`, [], { teto: 1 }))[0]?.['Q']);
        return out;
      };
      const antes = await contar();
      const [cc] = await e.consultar(
        "SELECT FIRST 1 COD FROM TBCENCUS WHERE COALESCE(SITUACAO, 'A') <> 'I' ORDER BY COD",
        [],
        { teto: 1 },
      );
      const h = a.c.hospital;
      const cifra = new CifraCpf(randomBytes(32));
      const v = await incluirVinculoPesSgh(somenteSgh(e), {
        hospital: h,
        pessoa: null,
        cpfHmac: cifra.hmac(CPF),
        cpfCifrado: cifra.cifrar(CPF),
        nome: 'COLABORADOR SINTETICO M53.8',
        profissional: null,
        usuario: null,
        tipo: 'clt',
        matricula: `SP538-${Date.now().toString(36)}`,
        cargo: 'Auxiliar administrativo',
        funcao: null,
        cargaSemanal: 44,
        centroCusto: n(cc?.['COD']),
        unidade: null,
        setor: null,
        admissao: '2009-09-01',
        por: 'SGH.TESTE',
      });
      const ctx = { rede: a.c.rede, hospital: h };
      const folha = portaFolhaNaTransacao(e);
      const empresa = (await folha.empresas(ctx))[0]!.codigo;
      const trilha = new RegistradorTrilhaMemoria();
      const recursos = ['pessoas.colaborador', 'pessoas.folha'];
      const config = fonteConfiguracaoMemoria(trilha, {
        chavesIniciais: () => recursos.map(chave),
        prerequisitosIniciais: () => recursos.map(cumprido),
      });
      const pessoas = portaPessoasNaTransacao(e, a.executor);
      const calculo = portaCalculoFolhaNaTransacao(e);
      const portaEsocial = portaEsocialNaTransacao(e);
      const esocial = new ServicoEsocial(
        portaEsocial,
        folha,
        calculo,
        portaRubricasNaTransacao(e),
        pessoas,
        cifra,
        trilha,
        config,
        null,
        'dev',
      );
      const periodicos = new ServicoPeriodicosEsocial(esocial);
      const fechamento = new ServicoFechamentoFolha(calculo, folha, portaEsocial, trilha, config, null);
      const obrigacoes = new ServicoObrigacoes(esocial, trilha, config, null);
      let k = 0;
      const s = (): SessaoCadastro => ({
        req: {
          headers: { 'idempotency-key': `int-m538-${++k}` },
          ip: '127.0.0.1',
          sgh: { sessao: { unidadeAtiva: null } },
        } as never,
        hospital: h,
        rede: a.c.rede,
        login: 'SGH.TESTE',
        porta: ctx,
        pode: () => true,
      });
      // A folha mensal sintética de 2009-09 com as bases e o FGTS, gravada pelo gravador do cálculo.
      const sgh = somenteSgh(e);
      const processo = await incluirProcessoFolhaPesSgh(sgh, {
        hospital: h,
        empresa,
        competencia: COMP,
        numero: 1,
        totais: {
          colaboradores: 1,
          proventos: 300_000,
          descontos: 24_000,
          liquido: 276_000,
          inss: 24_000,
          irrf: 0,
          fgts: 24_000,
          inssPatronal: 60_000,
          rat: 9_000,
          terceiros: 17_400,
        },
        foraDaFolha: 0,
        tabelaLegal: '2009-01-01',
        parametros: '2009-01-01',
        resumo: 'f'.repeat(64),
        por: 'SGH.TESTE',
      });
      const linha = (
        papel: 'salario' | 'inss' | 'baseInss' | 'baseFgts' | 'fgts',
        tipo: 'provento' | 'desconto' | 'base' | 'informativa',
        cod: number,
        valor: number,
      ) => ({
        papel,
        tipo,
        rubrica: cod,
        codigoRubrica: cod,
        quantidade: 0,
        unidade: 'valor' as const,
        valor,
        memoria: 'integração sintética',
        vinculo: v.id,
        centroCusto: n(cc?.['COD']),
        diasPagos: 30,
      });
      await incluirLinhasCalculoPesSgh(sgh, {
        hospital: h,
        processo,
        linhas: [
          linha('salario', 'provento', 1, 300_000),
          linha('inss', 'desconto', 901, 24_000),
          linha('baseInss', 'base', 902, 300_000),
          linha('baseFgts', 'base', 903, 300_000),
          linha('fgts', 'informativa', 904, 24_000),
        ],
      });
      await fechamento.fechar(s(), {
        empresa,
        apuracao: 'mensal',
        periodo: COMP,
        pagamento: '2009-10-05',
        simular: false,
      });
      const apoio = await esocial.apoioTela(s());
      const temCnpj = apoio.empresas.find((x) => x.codigo === empresa)?.temCnpj ?? false;
      await esocial.registrarEmpregador(s(), {
        empresa,
        inicio: '2009-01',
        transmissor: 'sante',
        leiaute: 'v_S_01_03_00',
        classTrib: '99',
        indCoop: null,
        indConstr: null,
        indDesFolha: 0,
        indOptRegEletron: 0,
        cnaePrep: '8610101',
        aliqRat: 3,
        fap: 10_000,
        codLotacao: 'LOTSGH',
        fpas: '515',
        codTercs: '0115',
        ideTabRubr: 'SGH',
        cnpjSindicato: null,
        motivosAfastamento: {},
      });
      await esocial.registrarFicha(s(), v.id, { ficha: FICHA, versao: null });

      // Parâmetros das obrigações (vigência) e a repetição recusada.
      const params = await obrigacoes.registrarParametros(s(), parametros(empresa));
      const repetida = await obrigacoes
        .registrarParametros(s(), parametros(empresa))
        .then(() => 'gravou', codigoDe);
      const catalogos = await calculo.catalogosObrigacoes(ctx);

      // FGTS Digital: sem o S-1200 aceito, a apuração aponta a pendência.
      const fgtsAntes = await obrigacoes.apuracaoFgts(s(), { empresa, competencia: COMP });
      let fgts = null;
      let entregaFgts = null;
      let guiaErrada = null;
      let cancelarEntregue = null;
      if (temCnpj) {
        const s1200 = await periodicos.gerarRemuneracao(s(), {
          empresa,
          apuracao: 'mensal',
          periodo: COMP,
          vinculos: [v.id],
          gravar: true,
        });
        const id = s1200.eventos[0]!.id!;
        const lote = await esocial.montarLote(s(), { empresa, eventos: [id] });
        await esocial.enviarLote(s(), lote.lote.id, { versao: lote.lote.versao });
        const l = await esocial.detalheLote(s(), lote.lote.id);
        await esocial.registrarRetorno(s(), lote.lote.id, {
          versao: l.lote.versao,
          protocolo: null,
          eventos: [
            {
              evento: id,
              aceito: true,
              recibo: '1.2.0000000000000000538',
              codigo: '201',
              descricao: 'Sintético',
            },
          ],
        });
        const apurada = await obrigacoes.apuracaoFgts(s(), { empresa, competencia: COMP });
        fgts = await obrigacoes.gerar(s(), {
          empresa,
          tipo: 'fgts-digital',
          periodo: COMP,
          simular: false,
          recolhimento: null,
        });
        const o = fgts.obrigacao!;
        const guia = (fgts.totais?.fgts ?? 0) + (fgts.totais?.rescisorio ?? 0);
        guiaErrada = await obrigacoes
          .registrarEntrega(s(), o.id, {
            versao: o.versao,
            protocolo: 'GFD-SINT-1',
            data: '2009-10-07',
            valorGuia: guia + 1,
            acrescimos: 0,
          })
          .then(() => 'entregou', codigoDe);
        entregaFgts = await obrigacoes.registrarEntrega(s(), o.id, {
          versao: o.versao,
          protocolo: 'GFD-SINT-1',
          data: '2009-10-07',
          valorGuia: guia,
          acrescimos: 0,
        });
        cancelarEntregue = await obrigacoes
          .cancelar(s(), o.id, { versao: entregaFgts.versao, motivo: 'Integração sintética' })
          .then(() => 'cancelou', codigoDe);
        fgts = { ...fgts, apurada };
      }

      // SEFIP: prévia, geração com o arquivo cifrado, leitura conferida, entrega recusada (leiaute não conferido),
      // cancelamento.
      const sefipPrevia = await obrigacoes.gerar(s(), {
        empresa,
        tipo: 'sefip',
        periodo: COMP,
        simular: true,
        recolhimento: '2009-10-07',
      });
      let sefip = null;
      let arquivoSefip = null;
      let entregaSefip = null;
      let canceladaSefip = null;
      if (sefipPrevia.pendencias.length === 0) {
        sefip = await obrigacoes.gerar(s(), {
          empresa,
          tipo: 'sefip',
          periodo: COMP,
          simular: false,
          recolhimento: '2009-10-07',
        });
        const o = sefip.obrigacao!;
        arquivoSefip = await obrigacoes.arquivo(s(), o.id);
        entregaSefip = await obrigacoes
          .registrarEntrega(s(), o.id, {
            versao: o.versao,
            protocolo: 'SEFIP-SINT-1',
            data: '2009-10-07',
            valorGuia: null,
            acrescimos: null,
          })
          .then(() => 'entregou', codigoDe);
        canceladaSefip = await obrigacoes.cancelar(s(), o.id, {
          versao: o.versao,
          motivo: 'Integração sintética',
        });
      }
      const caged = await obrigacoes.gerar(s(), {
        empresa,
        tipo: 'caged',
        periodo: COMP,
        simular: true,
        recolhimento: null,
      });
      const rais = await obrigacoes.gerar(s(), {
        empresa,
        tipo: 'rais',
        periodo: '2009',
        simular: true,
        recolhimento: null,
      });
      const lista = await obrigacoes.listar(s(), { empresa, ano: '2009' });
      const depois = await contar();
      return {
        antes,
        depois,
        params,
        repetida,
        catalogos,
        temCnpj,
        fgtsAntes,
        fgts,
        guiaErrada,
        entregaFgts,
        cancelarEntregue,
        sefipPrevia,
        sefip,
        arquivoSefip,
        entregaSefip,
        canceladaSefip,
        caged,
        rais,
        lista,
        vinculo: v.id,
      };
    });

    expect(r.depois).toEqual(r.antes);
    expect(r.params.itens.map((x) => x.inicio)).toEqual(['2009-01']);
    expect(r.params.itens[0]!.regimes.sefip).toMatchObject({ leiaute: 'SEFIP 8.4', leiauteConferido: false });
    expect(r.repetida).toBe('parametros-vigencia-repetida');
    // Os catálogos oficiais do banco existem (as contagens bastam: são tabelas de códigos públicos).
    expect(r.catalogos.categoriasSefip.length).toBeGreaterThan(0);
    expect(r.catalogos.desligamentosCaged.length).toBeGreaterThan(0);
    expect(r.fgtsAntes.exigida).toBe(true);
    expect(r.fgtsAntes.fechamento?.numero).toBe(1);
    const t0 = r.fgtsAntes.trabalhadores?.find((x) => x.vinculo === r.vinculo);
    expect(t0).toMatchObject({ baseFgts: 300_000, fgts: 24_000, esocial: 'sem-evento' });
    expect(r.fgtsAntes.pendencias.map((p) => p.codigo)).toContain(
      r.temCnpj ? 'evento-esocial-pendente' : 'sem-empregador',
    );
    // A RAIS do ano pede os 12 meses e o 13º fechados.
    expect(r.rais.gerado).toBe(false);
    expect(r.rais.pendencias.map((p) => p.codigo)).toContain('folha-nao-fechada');
    // A cópia tem o CNPJ da empresa: o caminho completo roda (sem CNPJ, só a pendência do empregador acima).
    expect(r.temCnpj).toBe(true);
    if (!r.temCnpj) return;

    const apurada = r.fgts!.apurada;
    expect(apurada.trabalhadores?.find((x) => x.vinculo === r.vinculo)?.esocial).toBe('aceito');
    expect(apurada.pendencias).toEqual([]);
    expect(apurada.conferencia?.ok).toBe(true);
    expect(r.fgts!.gerado).toBe(true);
    expect(r.fgts!.obrigacao).toMatchObject({
      tipo: 'fgts-digital',
      periodo: COMP,
      numero: 1,
      situacao: 'gerada',
    });
    expect(r.fgts!.obrigacao!.resumo).toMatch(/^[0-9a-f]{64}$/);
    expect(r.guiaErrada).toBe('guia-divergente');
    expect(r.entregaFgts).toMatchObject({ situacao: 'entregue', entrega: { protocolo: 'GFD-SINT-1' } });
    expect(r.entregaFgts!.entrega!.valorGuia).toBe(24_000);
    expect(r.cancelarEntregue).toBe('obrigacao-ja-entregue');

    // A SEFIP: sem pendência, só o aviso do leiaute não conferido.
    expect(r.sefipPrevia.pendencias.map((p) => p.codigo)).toEqual([]);
    expect(r.sefipPrevia.avisos).toContain('leiaute-nao-conferido');
    expect(r.sefip!.obrigacao).toMatchObject({ tipo: 'sefip', situacao: 'gerada', leiauteConferido: false });
    const linhas = r.arquivoSefip!.conteudo.split(/\r?\n/).filter((x) => x.length > 0);
    expect(linhas.length).toBeGreaterThanOrEqual(4);
    expect(new Set(linhas.map((x) => x.length))).toEqual(new Set([360]));
    expect(r.arquivoSefip!.nome).toBe(r.sefip!.obrigacao!.nomeArquivo);
    expect(r.entregaSefip).toBe('leiaute-nao-conferido');
    expect(r.canceladaSefip).toMatchObject({ situacao: 'cancelada', motivo: 'Integração sintética' });
    // O CAGED do mês: a admissão do colaborador sintético.
    expect(r.caged.pendencias.map((p) => p.codigo)).toEqual([]);
    expect(r.caged.totais?.admissoes).toBeGreaterThanOrEqual(1);
    const situacoes = r.lista.itens.map((x) => `${x.tipo}:${x.situacao}`).sort();
    expect(situacoes).toEqual(['fgts-digital:entregue', 'sefip:cancelada']);
  }, 900_000);
});
