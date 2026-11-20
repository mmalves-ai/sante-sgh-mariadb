// Regras 17 a 19 do M52 sobre a cópia (transação DESFEITA; ficha, seções 4 a 6): um vínculo sintético (incluído na
// própria transação, sem CPF real: só um HMAC inventado) recebe o ASO admissional com exame, as três doses da hepatite B e
// o anti-HBs, um acidente com material biológico (sorologia de 4 marcos, prazo da CAT em dia útil, CAT emitida), o
// mapa de riscos com um fator real do domínio do eSocial (nome em BLOB) e o EPI exigido, a entrega de EPI e a leitura do
// dosímetro; as leituras do prontuário, da carteira, do EPI e do painel batem com o que foi gravado, com o p95 medido; e
// nenhuma tabela do outro sistema muda (contagens de TBPROFIS, TBUSERS, FPFUNC e STCAT antes e depois). Só contagens.
import { appendFileSync } from 'node:fs';
import { type ChaveGravada, incluirVinculoPesSgh, type PrerequisitoGravado } from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DOSES_VACINA_SESMT, VACINAS_SESMT } from '@sgh/contratos';
import { codigoNoDominio, somarDias } from '@sgh/dominio-pessoas';
import { RegistradorTrilhaMemoria } from '../../../autorizacao/trilha.js';
import {
  type AmbienteM27,
  ambienteM27,
  PODE_ESCREVER,
  percentil,
  usuariosAtivos,
} from '../../acesso/aplicacao/copia.spec-util.js';
import type { SessaoCadastro } from '../../cadastro/comum.js';
import { fonteConfiguracaoMemoria } from '../../config/public-api.js';
import { portaPessoasNaTransacao } from '../porta-legado.js';
import { portaSesmtNaTransacao } from './porta-sesmt-legado.js';
import { ServicoSesmt } from './servico-sesmt.js';

const ligada: ChaveGravada = {
  id: 'pessoas.sesmt',
  tipo: 'recurso',
  chave: 'pessoas.sesmt',
  escopo: 'hospital',
  valor: '*',
  ligada: true,
  ligadaAntes: null,
  lote: null,
  justificativa: 'integração sintética',
  alteradoPor: 'SGH.TESTE',
  alteradoEm: '2026-10-26T10:00:00',
};
const conferencia: PrerequisitoGravado = {
  recurso: 'pessoas.sesmt',
  tipo: 'aprovacao',
  situacao: 'cumprido',
  validade: null,
  evidencia: 'integração sintética',
  alteradoPor: 'SGH.TESTE',
  alteradoEm: '2026-10-26T10:00:00',
};
const n = (v: unknown) => Number(v ?? 0);

describe.skipIf(!PODE_ESCREVER)('SESMT na cópia (transação desfeita)', () => {
  let a: AmbienteM27;
  beforeAll(async () => {
    a = await ambienteM27();
  }, 900_000);
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  it('ASO, vacinas, acidente e CAT, riscos e EPI, dose; leituras e painel; nada do outro sistema muda', async () => {
    const r = await a.nucleo.desfazendoNaCopia({ ...a.c, traceId: 'int-m525-sesmt' }, async (e) => {
      const u = await usuariosAtivos(e);
      const contar = async () => {
        const out: number[] = [];
        for (const t of ['TBPROFIS', 'TBUSERS', 'FPFUNC', 'STCAT', 'FPCATFATRISCO']) {
          const [x] = await e.consultar(`SELECT COUNT(*) N FROM ${t}`, [], { teto: 1 });
          out.push(n(x?.['N']));
        }
        return out;
      };
      const antes = await contar();
      const trilhaSesmt = async () => {
        const [x] = await e.consultar(
          "SELECT COUNT(*) N FROM SGH_TRILHA WHERE TABELA_ALVO STARTING WITH 'SGH_PES_' AND EVENTO STARTING WITH 'pessoas.'",
          [],
          { teto: 1 },
        );
        return n(x?.['N']);
      };
      const trilha0 = await trilhaSesmt();
      const [cc] = await e.consultar(
        "SELECT FIRST 1 COD FROM TBCENCUS WHERE COALESCE(SITUACAO, 'A') <> 'I' ORDER BY COD",
        [],
        { teto: 1 },
      );
      const [h] = await e.consultar('SELECT CAST(CURRENT_DATE AS VARCHAR(10)) H FROM RDB$DATABASE', [], {
        teto: 1,
      });
      const hoje = String(h?.['H']);
      const ano = Number(hoje.slice(0, 4));
      const vinc = await incluirVinculoPesSgh(e, {
        hospital: a.c.hospital,
        pessoa: null,
        cpfHmac: 'f'.repeat(64),
        cpfCifrado: 'v1.sintetico-m525',
        nome: 'COLABORADORA SINTETICA M525',
        profissional: null,
        usuario: null,
        tipo: 'clt',
        matricula: 'SINT-M525-1',
        cargo: 'Técnico de enfermagem',
        funcao: null,
        cargaSemanal: 36,
        centroCusto: n(cc?.['COD']),
        unidade: null,
        setor: null,
        admissao: `${ano - 1}-01-10`,
        por: u.a,
      });
      const trilha = new RegistradorTrilhaMemoria();
      const servico = new ServicoSesmt(
        portaSesmtNaTransacao(e),
        portaPessoasNaTransacao(e, a.executor),
        trilha,
        fonteConfiguracaoMemoria(trilha, {
          chavesIniciais: () => [ligada],
          prerequisitosIniciais: () => [conferencia],
        }),
        null,
      );
      let k = 0;
      const s = (): SessaoCadastro => ({
        req: {
          headers: { 'idempotency-key': `int-m525-${Date.now().toString(36)}-${++k}` },
          ip: '127.0.0.1',
          sgh: { sessao: { unidadeAtiva: null } },
        } as never,
        hospital: a.c.hospital,
        rede: a.c.rede,
        login: u.a,
        porta: a.c,
        pode: () => true,
      });
      const apoio = await servico.apoioTela(s());
      const admissional = apoio.dominios.tiposAso.find((t) => t.codigo === 0);
      const ontem = somarDias(hoje, -1);
      const ocorrido = `${ontem}T08:00`;
      // ASO admissional com exame (regra 17).
      const aso = await servico.registrarAso(s(), {
        vinculo: vinc.id,
        tipo: 0,
        data: `${ano - 1}-01-05`,
        conclusao: 1,
        restricoes: null,
        medico: 'MEDICA DO TRABALHO SINTETICA',
        medicoConselho: null,
        proximo: null,
        observacao: null,
        exames: [{ exame: 'Hemograma completo', data: `${ano - 1}-01-03`, resultado: 'normal' }],
        retifica: null,
        motivoRetificacao: null,
      });
      // Vacinas: hepatite B completa e o anti-HBs.
      for (const [dose, mes] of [
        ['1', '01'],
        ['2', '02'],
        ['3', '07'],
      ] as const)
        await servico.registrarVacina(s(), {
          vinculo: vinc.id,
          registro: 'dose',
          vacina: 'hepatite-b',
          dose,
          data: `${ano - 1}-${mes}-10`,
          lote: 'L-SINT',
          validadeLote: `${ano + 1}-12-31`,
          antiHbs: null,
          observacao: null,
          retifica: null,
          motivoRetificacao: null,
        });
      await servico.registrarVacina(s(), {
        vinculo: vinc.id,
        registro: 'anti-hbs',
        vacina: 'hepatite-b',
        dose: null,
        data: `${ano - 1}-08-20`,
        lote: null,
        validadeLote: null,
        antiHbs: 85.5,
        observacao: null,
        retifica: null,
        motivoRetificacao: null,
      });
      // Acidente com material biológico (regra 18) e a CAT.
      const acid = await servico.registrarAcidente(s(), {
        vinculo: vinc.id,
        ocorridoEm: ocorrido,
        tipo: 'tipico',
        unidade: null,
        local: 'Posto de enfermagem sintético',
        descricao: 'Picada de agulha ao descartar material, cenário sintético.',
        biologico: true,
        perfurocortante: true,
        exposicao: 'percutanea',
        material: 'sangue',
        fonte: 'desconhecida',
        fonteTeste: null,
        parteCorpo: null,
        natureza: apoio.dominios.naturezas[0]?.codigo ?? null,
        agente: null,
        situacao: null,
        afastamento: false,
        obito: false,
        profilaxia: null,
        profilaxiaEm: null,
        profilaxiaObs: null,
      });
      const ac0 = await servico.acidente(s(), acid.id);
      await servico.emitirCat(s(), {
        acidente: acid.id,
        versao: ac0.versao,
        tipoCat: 1,
        iniciativa: 1,
        numero: 'SINT-CAT-M525',
        emitidaEm: hoje,
        cat: null,
      });
      // Mapa de riscos com fator real do domínio (busca no BLOB) e o EPI exigido; entrega e dosímetro (regra 19).
      const fatores = await servico.fatoresRisco(s(), 'biol');
      const fator = fatores.itens[0];
      await servico.incluirLinhaRisco(s(), {
        unidade: null,
        setor: null,
        funcao: 'Técnico de enfermagem',
        tipo: 'risco',
        fatorRisco: fator?.codigo ?? null,
        grupoRisco: 'B',
        epc: null,
        epi: null,
        descricao: null,
        inicio: `${ano}-01-01`,
      });
      await servico.incluirLinhaRisco(s(), {
        unidade: null,
        setor: null,
        funcao: 'TECNICO DE ENFERMAGEM',
        tipo: 'epi',
        fatorRisco: null,
        grupoRisco: null,
        epc: null,
        epi: 'Luva de procedimento',
        descricao: null,
        inicio: `${ano}-01-01`,
      });
      let ca = '';
      try {
        await servico.registrarEpi(s(), {
          tipo: 'epi',
          vinculo: vinc.id,
          data: hoje,
          epi: 'Luva de procedimento',
          caNumero: '12345',
          caValidade: `${ano - 1}-12-31`,
          quantidade: 2,
          observacao: null,
        });
      } catch (erro) {
        ca = String((erro as { extras?: { codigo?: string } }).extras?.codigo ?? '');
      }
      const entrega = await servico.registrarEpi(s(), {
        tipo: 'epi',
        vinculo: vinc.id,
        data: hoje,
        epi: 'Luva de procedimento',
        caNumero: '12345',
        caValidade: `${ano + 1}-12-31`,
        quantidade: 2,
        observacao: null,
      });
      await servico.registrarEpi(s(), {
        tipo: 'dosimetria',
        vinculo: vinc.id,
        periodoInicio: `${ano}-01-01`,
        data: `${ano}-01-31`,
        doseMsv: 0.25,
        dosimetro: 'DOS-SINT',
        observacao: null,
      });
      // Leituras, com o tempo de cada uma.
      const tempos: Record<string, number[]> = {
        prontuario: [],
        carteira: [],
        epi: [],
        painel: [],
        acidente: [],
      };
      const medir = async <T>(nome: string, fn: () => Promise<T>) => {
        const t0 = performance.now();
        const x = await fn();
        tempos[nome]!.push(performance.now() - t0);
        return x;
      };
      let pront, cart, epi, painel, acidente;
      for (let i = 0; i < 5; i++) {
        pront = await medir('prontuario', () => servico.prontuario(s(), vinc.id));
        cart = await medir('carteira', () => servico.carteira(s(), vinc.id));
        epi = await medir('epi', () => servico.epiDoColaborador(s(), vinc.id));
        painel = await medir('painel', () =>
          servico.painel(s(), { somentePendentes: false, pagina: 0, limite: 50, termo: 'SINTETICA M525' }),
        );
        acidente = await medir('acidente', () => servico.acidente(s(), acid.id));
      }
      const depois = await contar();
      // D-VAC-525: o código gravado vem do domínio de vacinas e de doses lido na hora (sem código fixo).
      const dom = await portaSesmtNaTransacao(e).dominios(a.c);
      const hbCodigo = codigoNoDominio(dom.vacinasCadastro, VACINAS_SESMT['hepatite-b'].termos);
      const vacGravadas = (
        await e.consultar(
          `SELECT COD_VAC V, COD_DOSE_VAC D FROM SGH_PES_VACINA WHERE ID_VINCULO = ${Number(vinc.id)} ORDER BY ID`,
          [],
          { teto: 10 },
        )
      ).map((x) => [x['V'] === null ? null : n(x['V']), x['D'] === null ? null : n(x['D'])]);
      const vacEsperadas = [
        ...(['1', '2', '3'] as const).map((d) => [
          hbCodigo,
          codigoNoDominio(dom.dosesVacinaCadastro, DOSES_VACINA_SESMT[d].termos),
        ]),
        [hbCodigo, null],
      ];
      // D-PPP-525: o PPP de consulta lê o histórico funcional e o mapa de riscos com a vigência.
      const ppp = await servico.ppp(s(), vinc.id);
      const [priv] = await e.consultar(
        `SELECT COUNT(*) N FROM RDB$USER_PRIVILEGES WHERE RDB$USER = 'SGH_APLICACAO'
           AND RDB$RELATION_NAME IN ('SGH_PES_OCUPACIONAL', 'SGH_PES_VACINA') AND RDB$PRIVILEGE IN ('U', 'D')`,
        [],
        { teto: 1 },
      );
      return {
        aso: aso.id > 0,
        admissional: admissional !== undefined,
        prontuario: pront!.asos.map((x) => [x.natureza, x.exames.length]),
        hb: cart!.situacao.find((x) => x.vacina === 'hepatite-b'),
        acidente: [
          acidente!.catNumero,
          acidente!.sorologias.length,
          acidente!.profilaxia,
          acidente!.catPrazo > ontem,
        ],
        fator: fator?.codigo ?? '',
        ca,
        entrega: entrega.id > 0,
        epi: [
          epi!.riscos.length,
          epi!.episFaltando,
          epi!.dose.totalMsv,
          epi!.riscos.some((x) => x.fatorRiscoRotulo),
        ],
        painel: painel!.itens.map((x) => x.vinculo),
        trilha: (await trilhaSesmt()) - trilha0,
        antes,
        depois,
        privUpdate: n(priv?.['N']),
        vacinas: [dom.vacinasCadastro.length > 0, dom.dosesVacinaCadastro.length > 0],
        vacGravadas,
        vacEsperadas,
        ppp: [
          ppp.periodos.length,
          ppp.periodos[0]?.linhas.length,
          ppp.asos?.length,
          ppp.registros.length > 0,
        ],
        p95: Object.fromEntries(Object.entries(tempos).map(([k2, v]) => [k2, Math.round(percentil(v, 95))])),
      };
    });
    expect(r.aso && r.admissional && r.entrega).toBe(true);
    expect(r.prontuario).toEqual([['admissional', 1]]);
    expect([r.hb?.completo, r.hb?.antiHbs, r.hb?.pendencias]).toEqual([true, 85.5, []]);
    expect(r.acidente).toEqual(['SINT-CAT-M525', 4, 'indicada', true]);
    expect(r.fator).toMatch(/^03\./);
    expect(r.ca).toBe('ca-vencido');
    expect(r.epi).toEqual([2, [], 0.25, true]);
    expect(r.painel).toHaveLength(1);
    // Uma linha da SGH_TRILHA por gravação: ASO, 4 vacinas, acidente, CAT, 2 linhas do mapa, entrega e dosímetro.
    expect(r.trilha).toBe(11);
    expect(r.depois).toEqual(r.antes);
    expect(r.privUpdate).toBe(0);
    expect(r.vacinas).toEqual([true, true]);
    expect(r.vacGravadas).toEqual(r.vacEsperadas);
    expect(r.ppp).toEqual([1, 2, 1, true]);
    // Ficha, seção 4: a ficha em p95 < 500 ms; aqui cada tela do SESMT, com a cópia compartilhada.
    for (const [k2, v] of Object.entries(r.p95)) expect(v, k2).toBeLessThan(500);
    // Evidência do tempo (só números): SGH_INT_SAIDA aponta o arquivo fora do repositório.
    const saida = process.env['SGH_INT_SAIDA'];
    if (saida) appendFileSync(saida, `M52.5 p95 (ms): ${JSON.stringify(r.p95)}\n`);
  }, 900_000);
});
