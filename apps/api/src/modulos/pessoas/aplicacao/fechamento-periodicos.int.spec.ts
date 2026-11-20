// Fechamento da folha e periódicos do eSocial (M53.7, fatia F6; ficha do M53, seções 6 a 10; regras 1, 7, 9 e 10) sobre
// a cópia (transação DESFEITA): um colaborador sintético com a ficha cifrada e a folha mensal de 2009-09 gravada pelo
// gravador do cálculo; a prévia e o fechamento do período (SGH_PES_FOLHA_FECHAMENTO, do 0997), o período fechado
// recusando novo processamento, o painel dos periódicos, o S-1200 conferido no XSD e gravado (o CHECK do evento aceita
// os periódicos), o lote ao coletor com o retorno, o S-1299 (ou a pendência do autônomo do repasse, regra 1) e a
// reabertura da folha. Antes e depois, as tabelas de folha e de eSocial do outro sistema têm a mesma contagem. Só
// contagens e formatos no que se afirma; nenhum dado real impresso.
import { randomBytes } from 'node:crypto';
import type { FichaEsocialVinculo } from '@sgh/contratos';
import {
  type ChaveGravada,
  fechamentoEmVigorComTravaPesSgh,
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
/** CPF sintético com dígitos válidos (não é de pessoa real). */
const CPF = '52998224725';
/** Competência sintética longe de qualquer dado real (o leiaute aceita períodos a partir de 2000; nada do Sante SGH tem esta competência). */
const COMP = '2009-09';

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
};

describe.skipIf(!PODE_ESCREVER)(
  'fechamento da folha e periódicos do eSocial (cópia, transação desfeita)',
  () => {
    let a: AmbienteM27;
    beforeAll(async () => {
      a = await ambienteM27();
    }, 900_000);
    afterAll(async () => {
      await a?.nucleo.encerrar();
    });

    it('folha mensal → fechamento → período fechado → S-1200 no XSD → lote → retorno → S-1299 → reabertura; outro sistema intacto', async () => {
      const r = await a.nucleo.desfazendoNaCopia({ ...a.c, traceId: 'int-m537-periodicos' }, async (e) => {
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
          nome: 'COLABORADOR SINTETICO M53.7',
          profissional: null,
          usuario: null,
          tipo: 'clt',
          matricula: `SP537-${Date.now().toString(36)}`,
          cargo: 'Auxiliar administrativo',
          funcao: null,
          cargaSemanal: 44,
          centroCusto: n(cc?.['COD']),
          unidade: null,
          setor: null,
          admissao: '2009-01-04',
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
        let k = 0;
        const s = (): SessaoCadastro => ({
          req: {
            headers: { 'idempotency-key': `int-m537-${++k}` },
            ip: '127.0.0.1',
            sgh: { sessao: { unidadeAtiva: null } },
          } as never,
          hospital: h,
          rede: a.c.rede,
          login: 'SGH.TESTE',
          porta: ctx,
          pode: () => true,
        });
        // A folha mensal sintética de 2009-09, gravada pelo gravador do cálculo (sem o cálculo: só os valores).
        const sgh = somenteSgh(e);
        const processo = await (async () => {
          const id = await incluirProcessoFolhaPesSgh(sgh, {
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
            papel: 'salario' | 'inss',
            tipo: 'provento' | 'desconto',
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
            processo: id,
            linhas: [linha('salario', 'provento', 1, 300_000), linha('inss', 'desconto', 901, 24_000)],
          });
          return id;
        })();
        const previa = await fechamento.fechar(s(), {
          empresa,
          apuracao: 'mensal',
          periodo: COMP,
          pagamento: '2009-10-05',
          simular: true,
        });
        const fechado = await fechamento.fechar(s(), {
          empresa,
          apuracao: 'mensal',
          periodo: COMP,
          pagamento: '2009-10-05',
          simular: false,
        });
        // Período fechado: o gravador do cálculo recusa outro processamento da competência.
        const recusado = await incluirProcessoFolhaPesSgh(sgh, {
          hospital: h,
          empresa,
          competencia: COMP,
          numero: 2,
          totais: {
            colaboradores: 0,
            proventos: 0,
            descontos: 0,
            liquido: 0,
            inss: 0,
            irrf: 0,
            fgts: 0,
            inssPatronal: 0,
            rat: 0,
            terceiros: 0,
          },
          foraDaFolha: 0,
          tabelaLegal: '2009-01-01',
          parametros: '2009-01-01',
          resumo: 'e'.repeat(64),
          por: 'SGH.TESTE',
        }).then(
          () => 'gravou',
          (x: { problema?: { codigo?: string } }) => x.problema?.codigo ?? String(x),
        );

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
        const periodo = { empresa, apuracao: 'mensal' as const, periodo: COMP };
        const painel = await periodicos.painel(s(), periodo);
        const t0 = performance.now();
        const s1200 = temCnpj
          ? await periodicos.gerarRemuneracao(s(), { ...periodo, vinculos: [v.id], gravar: true })
          : null;
        const msS1200 = performance.now() - t0;
        // M53.7 (sessão 2): a lista do ano que a aba Fechamento mostra e a prévia do S-1210 do mês do pagamento.
        const lista = await fechamento.listar(s(), { empresa, ano: COMP.slice(0, 4) });
        const s1210 = temCnpj
          ? await periodicos.gerarPagamentos(s(), {
              empresa,
              periodo: '2009-10',
              vinculos: [v.id],
              gravar: false,
            })
          : null;
        let s1299 = null;
        if (s1200?.eventos[0]?.id && s1200.eventos[0].valido) {
          const id = s1200.eventos[0].id;
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
                recibo: '1.2.0000000000000000537',
                codigo: '201',
                descricao: 'Sintético',
              },
            ],
          });
          s1299 = await periodicos.gerarFechamento(s(), { ...periodo, gravar: false });
        }
        const painelDepois = await periodicos.painel(s(), periodo);
        const reaberto = await fechamento.reabrir(s(), fechado.fechamento!.id, {
          versao: fechado.fechamento!.versao,
          motivo: 'Integração sintética',
        });
        const listaDepois = await fechamento.listar(s(), { empresa, ano: COMP.slice(0, 4) });
        const depois = await contar();
        return {
          lista,
          listaDepois,
          s1210,
          antes,
          depois,
          processo,
          previa,
          fechado,
          recusado,
          temCnpj,
          painel,
          s1200,
          msS1200,
          s1299,
          painelDepois,
          reaberto,
        };
      });

      expect(r.depois).toEqual(r.antes);
      expect(r.previa.pendencias).toEqual([]);
      expect(r.previa.conferencia.ok).toBe(true);
      expect(r.fechado.fechamento).toMatchObject({
        apuracao: 'mensal',
        periodo: COMP,
        situacao: 'fechada',
        pagamento: '2009-10-05',
        numero: 1,
      });
      expect(r.fechado.fechamento!.processos.map((p) => p.id)).toEqual([r.processo]);
      expect(r.fechado.fechamento!.resumo).toMatch(/^[0-9a-f]{64}$/);
      expect(r.recusado).toBe('competencia-fechada');
      expect(r.painel.folha?.id).toBe(r.fechado.fechamento!.id);
      expect(r.painel.remuneracao.esperados).toBe(1);
      expect(r.reaberto).toMatchObject({ situacao: 'reaberta', motivo: 'Integração sintética' });
      const daLista = (l: typeof r.lista) => l.itens.find((x) => x.id === r.fechado.fechamento!.id);
      expect(daLista(r.lista)?.situacao).toBe('fechada');
      expect(daLista(r.listaDepois)?.situacao).toBe('reaberta');
      if (!r.temCnpj) return;
      expect(
        r.s1200!.eventos[0]!.errosXsd.join(' | ') + JSON.stringify(r.s1200!.eventos[0]!.pendencias),
      ).toBe('[]');
      expect(r.s1200!.eventos[0]).toMatchObject({ evento: 'S-1200', valido: true });
      expect(r.s1200!.eventos[0]!.errosXsd).toEqual([]);
      expect(r.msS1200).toBeLessThan(30_000);
      // O S-1210 do mês do pagamento (2009-10, data de pagamento da folha fechada) sai conferido no leiaute.
      const p1210 = r.s1210!.eventos[0]!;
      expect(p1210.evento).toBe('S-1210');
      expect(p1210.errosXsd.join(' | ') + JSON.stringify(p1210.pendencias)).toBe('[]');
      expect(p1210.valido).toBe(true);
      expect(r.painelDepois.remuneracao.aceitos).toBe(1);
      // O S-1299 sai válido, ou pendente só pelos recibos de autônomo do repasse no período (D-RPA-PER-537).
      const f = r.s1299!.eventos[0]!;
      if (f.pendencias.length) expect(f.pendencias.map((p) => p.codigo)).toEqual(['repasse-sem-remuneracao']);
      else expect(f.valido).toBe(true);
    }, 900_000);

    it('corrida: o processamento novo que entra enquanto o fechamento grava esbarra na linha-guarda do período (0998)', async () => {
      const h = a.c.hospital;
      // Período sintético sem linha-guarda gravada: o caso da corrida (a linha nasce no fechamento, ainda sem COMMIT).
      const PER = '2009-10';
      const r = await a.nucleo.desfazendoNaCopia({ ...a.c, traceId: 'int-m537-corrida-1' }, async (e1) => {
        // O fechamento começa: grava a linha-guarda do período e relê o vigente com trava.
        const v = await fechamentoEmVigorComTravaPesSgh(somenteSgh(e1), h, 1, 'mensal', PER);
        // Outra conexão (sem espera) inclui o primeiro recibo de férias da competência enquanto o fechamento está aberto.
        const ferias = await a.nucleo
          .desfazendoNaCopia(
            { ...a.c, traceId: 'int-m537-corrida-2' },
            async (e2) => {
              await incluirProcessoFolhaPesSgh(somenteSgh(e2), {
                hospital: h,
                empresa: 1,
                competencia: PER,
                tipo: 'ferias',
                pagamento: '2009-10-01',
                numero: 1,
                totais: {
                  colaboradores: 1,
                  proventos: 100,
                  descontos: 0,
                  liquido: 100,
                  inss: 0,
                  irrf: 0,
                  fgts: 0,
                  inssPatronal: 0,
                  rat: 0,
                  terceiros: 0,
                },
                foraDaFolha: 0,
                tabelaLegal: '2009-01-01',
                parametros: '2009-01-01',
                resumo: 'e'.repeat(64),
                por: 'SGH.TESTE',
              });
              return 'incluiu';
            },
            { semEspera: true },
          )
          .catch(
            (erro: unknown) => (erro as { problema?: { codigo?: string } }).problema?.codigo ?? String(erro),
          );
        return { vigente: v.vigente, ferias };
      });
      expect(r).toEqual({ vigente: null, ferias: 'desatualizado' });
    }, 300_000);
  },
);
