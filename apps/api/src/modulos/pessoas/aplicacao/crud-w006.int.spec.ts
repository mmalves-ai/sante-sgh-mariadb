// W0-06 (programa CRUD completo) sobre a cópia (transação DESFEITA): o SQL real do script 1060 e das gravações da
// exclusão do rascunho e do cancelamento da escala, da anulação da vigência do regime, da desistência do ajuste de
// ponto e da situação da regra do banco, com as recusas que o BANCO também faz (CHECK da desistência por outra pessoa,
// FK do realizado). Vínculos sintéticos (CPF só como HMAC de mentira); só contagens e IDs em memória; nada do sistema
// anterior é escrito (somenteSgh) e as contagens das tabelas tocadas voltam ao ROLLBACK. Parte 4a-2: cargos e salários
// (script 1065) com a recusa 409 do cargo referenciado, a inativação e a exclusão do nunca usado com retrato. Parte 5c:
// avaliação de desempenho e PDI (script 1066): ciclo, ciência, correção por versão, alerta de experiência, 409 e CHECKs.
import {
  type ChaveGravada,
  gravarRegraBancoPesSgh,
  incluirAjustePontoPesSgh,
  incluirEventoPeriodoPesSgh,
  incluirVinculoPesSgh,
  type PrerequisitoGravado,
  regrasBancoPesSgh,
  situacaoRegraBancoPesSgh,
  desistirAjustePesSgh,
  dependentesDaFolhaPesSgh,
  desfazerEstornoRealizadoPesSgh,
  ligarEstornoRealizadoPesSgh,
  estornoLancadoDoRealizadoPesSgh,
  incluirSalarioPesSgh,
  somenteSgh,
} from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RegistradorTrilhaMemoria } from '../../../autorizacao/trilha.js';
import { ErroProblema } from '../../../problema.filter.js';
import { type AmbienteM27, ambienteM27, PODE_ESCREVER } from '../../acesso/aplicacao/copia.spec-util.js';
import type { SessaoCadastro } from '../../cadastro/comum.js';
import { fonteConfiguracaoMemoria } from '../../config/public-api.js';
import { portaEscalaNasTransacoes } from '../escala/porta-escala-legado.js';
import { ServicoEscala } from '../escala/servico-escala.js';
import { portaRealizadoNaTransacao } from '../escala/porta-realizado-legado.js';
import { ServicoRealizado } from '../escala/servico-realizado.js';
import { portaTreinamentoNaTransacao } from '../treinamento/porta-treinamento-legado.js';
import { ServicoTreinamento } from '../treinamento/servico-treinamento.js';
import { portaPessoasNaTransacao } from '../porta-legado.js';
import { portaPontoNaTransacao } from '../ponto/porta-ponto-legado.js';
import { CifraCpf } from '../cifra-cpf.js';
import { cpfSintetico } from '../porta-memoria.js';
import { ServicoPessoas } from '../servico.js';
import { portaEsocialNaTransacao } from '../esocial/porta-esocial-legado.js';
import { ServicoEsocial } from '../esocial/servico-esocial.js';
import { portaCalculoFolhaNaTransacao } from '../folha/porta-calculo-legado.js';
import { portaFolhaNaTransacao } from '../folha/porta-folha-legado.js';
import { portaRubricasNaTransacao } from '../rubricas/porta-rubricas-legado.js';
import { portaSesmtNaTransacao } from '../sesmt/porta-sesmt-legado.js';
import { ServicoSesmt } from '../sesmt/servico-sesmt.js';
import { portaCargosNaTransacao } from '../cargos/porta-cargos-legado.js';
import { ServicoCargos } from '../cargos/servico-cargos.js';
import { portaAvaliacaoNaTransacao } from '../avaliacao/porta-avaliacao-legado.js';
import { ServicoAvaliacao } from '../avaliacao/servico-avaliacao.js';
import type { FichaEsocialVinculo } from '@sgh/contratos';

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
  alteradoEm: '2026-11-18T10:00:00',
});
const cumprido = (recurso: string): PrerequisitoGravado => ({
  recurso,
  tipo: 'aprovacao',
  situacao: 'cumprido',
  validade: null,
  evidencia: 'integração sintética',
  alteradoPor: 'SGH.TESTE',
  alteradoEm: '2026-11-18T10:00:00',
});
const n = (v: unknown) => Number(v ?? 0);
const p2 = (x: number) => String(x).padStart(2, '0');
const TABELAS = [
  'SGH_PES_ESCALA',
  'SGH_PES_PLANTAO',
  'SGH_PES_ESCALA_EVENTO',
  'SGH_PES_REGIME_VINCULO',
  'SGH_PES_PONTO_AJUSTE',
  'SGH_PES_BANCO_REGRA',
  'SGH_HIST_EXCLUSAO',
] as const;

const FICHA_W006: FichaEsocialVinculo = {
  sexo: 'F',
  racaCor: 6,
  estadoCivil: null,
  grauInstrucao: '07',
  nomeSocial: null,
  nascimento: '1990-01-01',
  paisNascimento: '105',
  paisNacionalidade: '105',
  endereco: {
    tipoLogradouro: null,
    logradouro: 'Rua Sintetica',
    numero: '1',
    complemento: null,
    bairro: null,
    cep: '00000000',
    municipio: '3106200',
    uf: 'MG',
  },
  categoria: '101',
  cboCargo: '322205',
  cboFuncao: null,
  regimeJornada: 1,
  naturezaAtividade: 1,
  tipoContrato: 1,
  terminoContrato: null,
  tipoJornada: 2,
  tempoParcial: 0,
  descricaoJornada: 'Jornada sintetica da integracao',
  tipoAdmissao: 1,
  indicativoAdmissao: 1,
  cnpjSindicato: '33444555000106',
  estagio: null,
};

async function erro(p: Promise<unknown>) {
  const e = await p.then(
    () => null,
    (x: unknown) => x,
  );
  expect(e).not.toBeNull();
  if (e instanceof ErroProblema) return { codigo: e.extras['codigo'], bloqueios: e.extras.bloqueios ?? [] };
  const x = e as { problema?: { codigo?: string }; message?: string };
  return { codigo: x.problema?.codigo ?? x.message ?? String(e), bloqueios: [] as readonly string[] };
}

describe.skipIf(!PODE_ESCREVER)(
  'W0-06: CRUD da escala, do regime e do ponto (cópia, transação desfeita)',
  () => {
    let a: AmbienteM27;
    const TABELAS2 = [
      'SGH_PES_PLANTAO_REALIZADO',
      'SGH_PES_PLANTAO',
      'SGH_PES_CURSO',
      'SGH_PES_TREINAMENTO',
      'SGH_PES_TREIN_PARTICIPANTE',
      'SGH_PES_CORRECAO',
      'SGH_REP_APURACAO',
      'SGH_HIST_EXCLUSAO',
    ] as const;
    beforeAll(async () => {
      a = await ambienteM27();
    }, 900_000);
    afterAll(async () => {
      await a?.nucleo.encerrar();
    });

    it('exclusão do rascunho (órfão recusa, retrato antes do DELETE), cancelamento, anulação, desistência e regra', async () => {
      const contar = async (l: {
        consultar: (s: string, p: unknown[], o: { teto: number }) => Promise<Record<string, unknown>[]>;
      }) => {
        const r: Record<string, number> = {};
        for (const t of TABELAS) {
          const [x] = await l.consultar(`SELECT COUNT(*) N FROM ${t}`, [], { teto: 1 });
          r[t] = n(x?.['N']);
        }
        return r;
      };
      const antes = await a.nucleo.desfazendoNaCopia({ ...a.c, traceId: 'int-w006-antes' }, (e) => contar(e));
      const r = await a.nucleo.desfazendoNaCopia({ ...a.c, traceId: 'int-w006-crud' }, async (e) => {
        const [cc] = await e.consultar(
          "SELECT FIRST 1 COD FROM TBCENCUS WHERE COALESCE(SITUACAO, 'A') <> 'I' ORDER BY COD",
          [],
          { teto: 1 },
        );
        const [un] = await e.consultar('SELECT FIRST 1 COD FROM TBUNIDAD WHERE COD > 0 ORDER BY COD', [], {
          teto: 1,
        });
        const unidade = n(un?.['COD']);
        const s0 = somenteSgh(e);
        const v = await incluirVinculoPesSgh(s0, {
          hospital: a.c.hospital,
          pessoa: null,
          cpfHmac: 'f'.repeat(64),
          cpfCifrado: 'v1.sintetico',
          nome: 'APOIO SINTETICO W0-06',
          profissional: null,
          usuario: null,
          tipo: 'clt',
          matricula: null,
          cargo: 'Maqueiro',
          funcao: null,
          cargaSemanal: 36,
          centroCusto: n(cc?.['COD']),
          unidade,
          setor: null,
          admissao: '2026-01-01',
          por: 'SGH.TESTE',
        });
        const trilha = new RegistradorTrilhaMemoria();
        const pessoas = portaPessoasNaTransacao(e, a.executor);
        const porta = portaEscalaNasTransacoes(new Map([[a.c.hospital, e]]));
        const ponto = portaPontoNaTransacao(e);
        const servico = new ServicoEscala(
          porta,
          pessoas,
          trilha,
          fonteConfiguracaoMemoria(trilha, {
            chavesIniciais: () => ['pessoas.escala'].map(chave),
            prerequisitosIniciais: () => ['pessoas.escala'].map(cumprido),
          }),
          null,
          ponto,
        );
        let k = 0;
        const s = (login = 'SGH.TESTE'): SessaoCadastro => ({
          req: {
            headers: { 'idempotency-key': `int-w006-${Date.now().toString(36)}-${++k}` },
            ip: '127.0.0.1',
            sgh: { sessao: { unidadeAtiva: null } },
          } as never,
          hospital: a.c.hospital,
          rede: a.c.rede,
          login,
          porta: a.c,
          pode: () => true,
        });
        const hoje = await pessoas.hoje(a.c);
        const [ano, mes] = hoje.split('-').map(Number) as [number, number];
        const comp = mes === 12 ? `${ano + 1}-01` : `${ano}-${p2(mes + 1)}`;
        const nova = async (setor: string) =>
          (
            await servico.criarEscala(s(), {
              unidade,
              setor,
              competencia: comp,
              tipo: 'apoio',
              cobertura: { manha: 0, tarde: 0, noite: 0 },
            })
          ).id;
        const plantao = async (escala: number, d: string) =>
          (
            await servico.incluirPlantao(s(), {
              escala,
              vinculo: v.id,
              tipo: 'presencial',
              inicio: `${comp}-${d}T07:00`,
              fim: `${comp}-${d}T19:00`,
              chegadaMin: null,
              motivo: null,
            })
          ).id;
        const versao = async (id: number) => (await servico.grade(s(), id)).escala.versao;
        const MOTIVO = 'Escala sintética criada por engano no teste';

        // 1. Rascunho com realizado ligado (inserido direto, como faria um dado antigo): 409 com a contagem; sem DELETE.
        const esc1 = await nova('SINT W006 A');
        const pl1 = await plantao(esc1, '10');
        await s0.executar(
          `INSERT INTO SGH_PES_PLANTAO_REALIZADO (ID, HOSPITAL, ID_PLANTAO, ID_VINCULO, REAL_INICIO, REAL_FIM, MINUTOS,
           ORIGEM, INFORMADO_POR)
         VALUES (NEXT VALUE FOR SGH_GEN_PES_PLANTAO_REALIZADO, ?, CAST(CAST(? AS VARCHAR(20)) AS BIGINT),
           CAST(CAST(? AS VARCHAR(20)) AS BIGINT), CAST(CAST(? AS VARCHAR(24)) AS TIMESTAMP), CAST(CAST(? AS VARCHAR(24)) AS TIMESTAMP), 720, 'informado', 'SGH.TESTE')`,
          [a.c.hospital, String(pl1), String(v.id), `${comp}-10 07:00:00`, `${comp}-10 19:00:00`],
        );
        const orfao = await erro(
          servico.excluirEscala(s(), { escala: esc1, versao: await versao(esc1), motivo: MOTIVO }),
        );
        await s0.executar(
          `DELETE FROM SGH_PES_PLANTAO_REALIZADO WHERE ID_PLANTAO = CAST(CAST(? AS VARCHAR(20)) AS BIGINT)`,
          [String(pl1)],
        );
        // 2. Sem vínculo: exclui, com o retrato de cada linha (escala, plantão e a trilha da escala).
        const [h0] = await e.consultar('SELECT COALESCE(MAX(ID), 0) M FROM SGH_HIST_EXCLUSAO', [], {
          teto: 1,
        });
        await servico.excluirEscala(s(), { escala: esc1, versao: await versao(esc1), motivo: MOTIVO });
        const retratos = await e.consultar(
          `SELECT h.TABELA, h.OPERACAO, h.MOTIVO FROM SGH_HIST_EXCLUSAO h WHERE h.ID > ? ORDER BY h.ID`,
          [n(h0?.['M'])],
          { teto: 50 },
        );
        const [sobra] = await e.consultar(
          `SELECT (SELECT COUNT(*) FROM SGH_PES_ESCALA WHERE ID = CAST(CAST(? AS VARCHAR(20)) AS BIGINT)) +
                (SELECT COUNT(*) FROM SGH_PES_PLANTAO WHERE ID_ESCALA = CAST(CAST(? AS VARCHAR(20)) AS BIGINT)) N
           FROM RDB$DATABASE`,
          [String(esc1), String(esc1)],
          { teto: 1 },
        );
        // 3. Publicada: cancela com motivo; os plantões previstos ficam cancelados.
        const esc2 = await nova('SINT W006 B');
        await plantao(esc2, '12');
        await servico.publicar(s(), { escala: esc2, versao: await versao(esc2), justificativaFuro: null });
        await servico.cancelarEscala(s(), {
          escala: esc2,
          versao: await versao(esc2),
          motivo: 'Setor sintético fechado no teste',
        });
        const g2 = await servico.grade(s(), esc2);
        // 4. Vigência: com ponto fechado recusa; reaberto, anula; a certa entra na mesma data.
        const regime = (
          await servico.incluirRegime(s(), {
            codigo: 'SINT-W006',
            nome: 'Regime sintético W0-06',
            jornada: 1,
            contratoParcial: 0,
            folgaPadrao: null,
            minutosPlantao: 720,
            descansoMinimoMin: 660,
            limiteSemanalHoras: 44,
            acordo: null,
            ativo: true,
          })
        ).id;
        const vig = (await servico.atribuirRegime(s(), { vinculo: v.id, regime, desde: '2026-01-01' })).id;
        const fech = await incluirEventoPeriodoPesSgh(s0, {
          hospital: a.c.hospital,
          vinculo: v.id,
          competencia: '2026-02',
          acao: 'fechado',
          ref: null,
          hash: '0'.repeat(64),
          totais: '{}',
          concorda: null,
          texto: null,
          por: 'SGH.TESTE',
        });
        const vigFechada = await erro(
          servico.anularVigencia(s(), { vigencia: vig, motivo: 'Regime sintético lançado errado' }),
        );
        await incluirEventoPeriodoPesSgh(s0, {
          hospital: a.c.hospital,
          vinculo: v.id,
          competencia: '2026-02',
          acao: 'reaberto',
          ref: fech,
          hash: null,
          totais: null,
          concorda: null,
          texto: 'Reaberto no teste sintético',
          por: 'SGH.TESTE',
        });
        await servico.anularVigencia(s(), { vigencia: vig, motivo: 'Regime sintético lançado errado' });
        await servico.atribuirRegime(s(), { vinculo: v.id, regime, desde: '2026-01-01' });
        const hist = await servico.vigencias(s(), v.id);
        const emVigor = await porta.vigencias(a.c, [v.id]);
        // 5. Ajuste: a desistência só do solicitante (o UPDATE de outro não acha a linha; o CHECK do banco recusa).
        const aj = await incluirAjustePontoPesSgh(s0, {
          hospital: a.c.hospital,
          vinculo: v.id,
          dia: '2026-03-02',
          tipo: 'justificativa',
          marcacao: null,
          instante: null,
          movimento: 7,
          justificativa: null,
          periodo: null,
          minutos: 60,
          motivo: 'Consulta sintética',
          por: 'SGH.PEDE',
        });
        const deOutro = await erro(
          desistirAjustePesSgh(s0, {
            hospital: a.c.hospital,
            id: aj,
            versao: 0,
            motivo: 'Não fui eu',
            por: 'SGH.OUTRO',
          }),
        );
        const checkBanco = await s0
          .executar(
            `UPDATE SGH_PES_PONTO_AJUSTE SET SITUACAO = 'desistido', DECIDIDO_POR = 'SGH.OUTRO', DECIDIDO_EM = CURRENT_TIMESTAMP,
             MOTIVO_DECISAO = 'tentativa' WHERE ID = CAST(CAST(? AS VARCHAR(20)) AS BIGINT)`,
            [String(aj)],
          )
          .then(
            () => 'gravou',
            (x: unknown) =>
              /SGH_CK_PES_PONTO_AJ_OUTRO/.test(String((x as Error).message)) ? 'check' : String(x),
          );
        // 6. Regra do banco do regime: desativada com motivo pela versão lida (sai do fechamento).
        await gravarRegraBancoPesSgh(s0, {
          hospital: a.c.hospital,
          regime,
          destino: 2,
          inicio: 1,
          desde: '2026-01',
          cicloMeses: 6,
          faltaDebita: false,
          versao: null,
          por: 'SGH.TESTE',
        });
        await situacaoRegraBancoPesSgh(s0, {
          hospital: a.c.hospital,
          regime,
          versao: 0,
          ativo: false,
          motivo: 'Desativada no teste sintético',
          por: 'SGH.TESTE',
        });
        const regra = (await regrasBancoPesSgh(e, a.c.hospital)).find((x) => x.regime === regime);
        return {
          regra,
          orfao,
          retratos,
          sobra: n(sobra?.['N']),
          g2,
          vigFechada,
          hist,
          emVigor,
          deOutro,
          checkBanco,
        };
      });
      expect(r.orfao.codigo).toBe('escala-com-vinculos');
      expect(r.orfao.bloqueios).toEqual(['Plantões realizados: 1']);
      expect(r.retratos.map((x) => String(x['TABELA']).trim())).toEqual([
        'SGH_PES_ESCALA',
        'SGH_PES_PLANTAO',
        'SGH_PES_ESCALA_EVENTO',
        'SGH_PES_ESCALA_EVENTO',
      ]);
      expect(new Set(r.retratos.map((x) => String(x['OPERACAO']).trim()))).toEqual(
        new Set(['pessoas.excluirEscalaRascunho']),
      );
      expect(r.sobra).toBe(0);
      expect(r.g2.escala.estado).toBe('cancelada');
      expect(r.g2.escala.cancelamento?.motivo).toBe('Setor sintético fechado no teste');
      expect(r.g2.linhas.flatMap((l) => l.plantoes).every((p) => p.situacao === 'cancelado')).toBe(true);
      expect(r.vigFechada.codigo).toBe('vigencia-em-ponto-fechado');
      expect(r.hist.map((x) => x.anulada === null)).toEqual([false, true]);
      expect(r.emVigor).toHaveLength(1);
      expect(r.deOutro.codigo).toBe('desatualizado');
      expect(r.checkBanco).toBe('check');
      expect(r.regra).toMatchObject({
        ativo: false,
        motivoSituacao: 'Desativada no teste sintético',
        versao: 1,
      });
      const final = await a.nucleo.desfazendoNaCopia({ ...a.c, traceId: 'int-w006-final' }, (e) => contar(e));
      // Tudo desfeito: as contagens voltam ao que eram.
      expect(final).toEqual(antes);
      console.log(JSON.stringify({ antes, final, retratos: r.retratos.length, regra: r.regra }));
    }, 600_000);

    it('estorno do realizado (apurado recusa com a devolução) e correções do treinamento com o valor anterior', async () => {
      const contar = async (l: {
        consultar: (s: string, p: unknown[], o: { teto: number }) => Promise<Record<string, unknown>[]>;
      }) => {
        const r: Record<string, number> = {};
        for (const t of TABELAS2) {
          const [x] = await l.consultar(`SELECT COUNT(*) N FROM ${t}`, [], { teto: 1 });
          r[t] = n(x?.['N']);
        }
        return r;
      };
      const antes = await a.nucleo.desfazendoNaCopia({ ...a.c, traceId: 'int-w006-2-antes' }, (e) =>
        contar(e),
      );
      const r = await a.nucleo.desfazendoNaCopia({ ...a.c, traceId: 'int-w006-2-crud' }, async (e) => {
        const [cc] = await e.consultar(
          "SELECT FIRST 1 COD FROM TBCENCUS WHERE COALESCE(SITUACAO, 'A') <> 'I' ORDER BY COD",
          [],
          { teto: 1 },
        );
        const [un] = await e.consultar('SELECT FIRST 1 COD FROM TBUNIDAD WHERE COD > 0 ORDER BY COD', [], {
          teto: 1,
        });
        const unidade = n(un?.['COD']);
        const s0 = somenteSgh(e);
        const vinculo = (hmac: string, nome: string) =>
          incluirVinculoPesSgh(s0, {
            hospital: a.c.hospital,
            pessoa: null,
            cpfHmac: hmac.repeat(64),
            cpfCifrado: 'v1.sintetico',
            nome,
            profissional: null,
            usuario: null,
            tipo: 'clt',
            matricula: null,
            cargo: 'Técnico de enfermagem',
            funcao: null,
            cargaSemanal: 36,
            centroCusto: n(cc?.['COD']),
            unidade,
            setor: null,
            admissao: '2026-01-01',
            por: 'SGH.TESTE',
          });
        const v = await vinculo('e', 'PLANTONISTA SINTETICO W0-06');
        const v2 = await vinculo('d', 'INSCRITO SINTETICO W0-06');
        const trilha = new RegistradorTrilhaMemoria();
        const config = (c: string) =>
          fonteConfiguracaoMemoria(trilha, {
            chavesIniciais: () => [chave(c)],
            prerequisitosIniciais: () => [cumprido(c)],
          });
        const pessoas = portaPessoasNaTransacao(e, a.executor);
        const escala = new ServicoEscala(
          portaEscalaNasTransacoes(new Map([[a.c.hospital, e]])),
          pessoas,
          trilha,
          config('pessoas.escala'),
          null,
          portaPontoNaTransacao(e),
        );
        const realizado = new ServicoRealizado(
          portaRealizadoNaTransacao(e, a.executor),
          pessoas,
          null,
          trilha,
          config('pessoas.plantaoRealizado'),
          null,
        );
        const portaTrein = portaTreinamentoNaTransacao(e);
        const trein = new ServicoTreinamento(
          portaTrein,
          pessoas,
          trilha,
          config('pessoas.treinamento'),
          null,
        );
        let k = 0;
        const s = (login = 'SGH.TESTE'): SessaoCadastro => ({
          req: {
            headers: { 'idempotency-key': `int-w006-2-${Date.now().toString(36)}-${++k}` },
            ip: '127.0.0.1',
            sgh: { sessao: { unidadeAtiva: null } },
          } as never,
          hospital: a.c.hospital,
          rede: a.c.rede,
          login,
          porta: a.c,
          pode: () => true,
        });
        const hoje = await pessoas.hoje(a.c);
        const [ano, mes] = hoje.split('-').map(Number) as [number, number];
        const comp = mes === 12 ? `${ano + 1}-01` : `${ano}-${p2(mes + 1)}`;

        // ── Realizado ──────────────────────────────────────────────────────────────────────────────────────────
        const esc = (
          await escala.criarEscala(s(), {
            unidade,
            setor: 'SINT W006 R',
            competencia: comp,
            tipo: 'apoio',
            cobertura: { manha: 0, tarde: 0, noite: 0 },
          })
        ).id;
        const plantao = async (d: string) =>
          (
            await escala.incluirPlantao(s(), {
              escala: esc,
              vinculo: v.id,
              tipo: 'presencial',
              inicio: `${comp}-${d}T07:00`,
              fim: `${comp}-${d}T19:00`,
              chegadaMin: null,
              motivo: null,
            })
          ).id;
        const aprovado = async (pl: number, lancado: boolean) => {
          await s0.executar(
            `UPDATE SGH_PES_PLANTAO SET REAL_INICIO = CAST(CAST(? AS VARCHAR(24)) AS TIMESTAMP),
               REAL_FIM = CAST(CAST(? AS VARCHAR(24)) AS TIMESTAMP) WHERE ID = CAST(CAST(? AS VARCHAR(20)) AS BIGINT)`,
            [`${comp}-10 07:00:00`, `${comp}-10 19:00:00`, String(pl)],
          );
          await s0.executar(
            `INSERT INTO SGH_PES_PLANTAO_REALIZADO (ID, HOSPITAL, ID_PLANTAO, ID_VINCULO, REAL_INICIO, REAL_FIM, MINUTOS,
               ORIGEM, SITUACAO, INFORMADO_POR, DECIDIDO_POR, DECIDIDO_EM, VALOR, ID_RPLANEVE, LANCADO_POR, LANCADO_EM)
             VALUES (NEXT VALUE FOR SGH_GEN_PES_PLANTAO_REALIZADO, ?, CAST(CAST(? AS VARCHAR(20)) AS BIGINT),
               CAST(CAST(? AS VARCHAR(20)) AS BIGINT), CAST(CAST(? AS VARCHAR(24)) AS TIMESTAMP),
               CAST(CAST(? AS VARCHAR(24)) AS TIMESTAMP), 720, 'informado', 'aprovado', 'SGH.INFORMA', 'SGH.APROVA',
               CURRENT_TIMESTAMP, ?, ?, ?, CAST(CAST(? AS VARCHAR(24)) AS TIMESTAMP))`,
            [
              a.c.hospital,
              String(pl),
              String(v.id),
              `${comp}-10 07:00:00`,
              `${comp}-10 19:00:00`,
              lancado ? 600 : null,
              lancado ? 987_654_321 : null,
              lancado ? 'SGH.LANCA' : null,
              lancado ? hoje : null,
            ],
          );
          const [x] = await e.consultar(
            'SELECT ID FROM SGH_PES_PLANTAO_REALIZADO WHERE ID_PLANTAO = CAST(CAST(? AS VARCHAR(20)) AS BIGINT)',
            [String(pl)],
            { teto: 1 },
          );
          return n(x?.['ID']);
        };
        const linha = async (id: number) => {
          const [x] = await e.consultar(
            `SELECT r.SITUACAO, r.MOTIVO_ESTORNO, r.ESTORNADO_POR, r.VERSAO, p.REAL_INICIO
               FROM SGH_PES_PLANTAO_REALIZADO r JOIN SGH_PES_PLANTAO p ON p.ID = r.ID_PLANTAO
              WHERE r.ID = CAST(CAST(? AS VARCHAR(20)) AS BIGINT)`,
            [String(id)],
            { teto: 1 },
          );
          return {
            situacao: String(x?.['SITUACAO']).trim(),
            motivo: x?.['MOTIVO_ESTORNO'] ?? null,
            por: x?.['ESTORNADO_POR'] ? String(x['ESTORNADO_POR']).trim() : null,
            versao: n(x?.['VERSAO']),
            realNoPlantao: x?.['REAL_INICIO'] !== null && x?.['REAL_INICIO'] !== undefined,
          };
        };
        // 1. Não lançado: estorna com motivo; o horário real sai do plantão; o banco recusa estorno sem motivo.
        const r1 = await aprovado(await plantao('10'), false);
        const checkSemMotivo = await s0
          .executar(
            `UPDATE SGH_PES_PLANTAO_REALIZADO SET SITUACAO = 'estornado' WHERE ID = CAST(CAST(? AS VARCHAR(20)) AS BIGINT)`,
            [String(r1)],
          )
          .then(
            () => 'gravou',
            (x: unknown) =>
              /SGH_CK_PES_PLANTAO_REAL_EST/.test(String((x as Error).message)) ? 'check' : String(x),
          );
        await realizado.estornar(s('SGH.COORD'), {
          realizado: r1,
          versao: (await linha(r1)).versao,
          motivo: 'Plantão sintético aprovado por engano',
        });
        const estornado = await linha(r1);
        // Sem lançamento do repasse, não há o que ligar; desfeito, volta a aprovado com o horário real no plantão.
        const ligarSemLanc = await erro(
          ligarEstornoRealizadoPesSgh(s0, { hospital: a.c.hospital, id: r1, lancamento: 1 }),
        );
        await desfazerEstornoRealizadoPesSgh(s0, { hospital: a.c.hospital, id: r1 });
        const desfeito = await linha(r1);
        // 2. Lançado com o repasse da competência já apurado: 409 com a devolução da apuração; nada muda.
        const r2 = await aprovado(await plantao('11'), true);
        const [ap] = await e.consultar(
          'SELECT ID FROM SGH_REP_APURACAO WHERE HOSPITAL = ? AND EMPRESA = 1 AND COMPETENCIA = ?',
          [a.c.hospital, comp],
          { teto: 1 },
        );
        if (ap)
          await s0.executar(
            `UPDATE SGH_REP_APURACAO SET ESTADO = 'conferida' WHERE ID = CAST(CAST(? AS VARCHAR(20)) AS BIGINT)`,
            [String(n(ap['ID']))],
          );
        else
          await s0.executar(
            `INSERT INTO SGH_REP_APURACAO (ID, HOSPITAL, EMPRESA, COMPETENCIA, ESTADO, APURADO_POR, CONFERIDO_POR,
               CONFERIDO_EM) VALUES (NEXT VALUE FOR SGH_GEN_REP_APURACAO, ?, 1, ?, 'conferida', 'SGH.APURA', 'SGH.CONFERE',
               CURRENT_TIMESTAMP)`,
            [a.c.hospital, comp],
          );
        const apurado = await erro(
          realizado.estornar(s('SGH.COORD'), {
            realizado: r2,
            versao: (await linha(r2)).versao,
            motivo: 'Plantão sintético lançado por engano',
          }),
        );
        const r2Depois = await linha(r2);

        // ── Treinamento ────────────────────────────────────────────────────────────────────────────────────────
        const linhaTrilha = {
          rede: a.c.rede,
          hospital: a.c.hospital,
          usuario: 'SGH.TESTE',
          evento: 'pessoas.turma.incluida',
          recurso: 'pessoas.treinamento',
          operacao: 'pessoas.turma.incluida',
          tabelaAlvo: 'SGH_PES_TREINAMENTO',
          idAlvo: null,
          chaveNaturalAlvo: null,
          resultado: 'sucesso',
          estacao: null,
          correlacao: 'int-w006-2',
        };
        const turma = await portaTrein.gravarSgh(a.c, linhaTrilha, async (g): Promise<number> => {
          const curso = await g.incluirCurso({
            codigo: 'SINTW006',
            titulo: 'Curso sintético W0-06',
            conteudo: 'Conteúdo sintético',
            categoria: 'nr32',
            cargaMinimaMin: 60,
            validadeMeses: 12,
            obrigatorio: false,
            alvos: [],
            por: 'SGH.TESTE',
          });
          const t = await g.incluirTurma({
            curso,
            inicio: '2026-02-10',
            fim: '2026-02-11',
            cargaMin: 120,
            instrutor: 'INSTRUTORA SINTETICA',
            modalidade: 'presencial',
            local: 'Auditório',
            pop: null,
            observacao: null,
            por: 'SGH.TESTE',
          });
          await g.incluirParticipante({ treinamento: t, vinculo: v.id, por: 'SGH.TESTE' });
          await g.incluirParticipante({ treinamento: t, vinculo: v2.id, por: 'SGH.TESTE' });
          return t;
        });
        const participante = async (vinc: number) =>
          (await trein.turma(s(), turma)).lista.find((x) => x.vinculo === vinc)!;
        const MOTIVO_T = 'Turma sintética lançada com a data errada';
        await trein.alterarTurma(s(), {
          treinamento: turma,
          inicio: '2026-02-12',
          fim: '2026-02-12',
          cargaMin: 180,
          instrutor: 'OUTRA INSTRUTORA',
          modalidade: 'em-servico',
          local: null,
          pop: null,
          observacao: null,
          motivo: MOTIVO_T,
          versao: (await trein.turma(s(), turma)).versao,
        });
        await trein.registrarParticipacao(s(), {
          treinamento: turma,
          vinculo: v.id,
          presenca: 'presente',
          aproveitamento: null,
          conclusao: null,
          observacao: null,
          versao: (await participante(v.id)).versao,
        });
        const comPresenca = await erro(
          trein.retirarInscricao(s(), {
            treinamento: turma,
            vinculo: v.id,
            motivo: 'Inscrição sintética feita por engano',
            versao: (await participante(v.id)).versao,
          }),
        );
        const [h0] = await e.consultar('SELECT COALESCE(MAX(ID), 0) M FROM SGH_HIST_EXCLUSAO', [], {
          teto: 1,
        });
        await trein.retirarInscricao(s(), {
          treinamento: turma,
          vinculo: v2.id,
          motivo: 'Inscrição sintética feita por engano',
          versao: (await participante(v2.id)).versao,
        });
        const retratos = await e.consultar(
          'SELECT h.TABELA, h.OPERACAO FROM SGH_HIST_EXCLUSAO h WHERE h.ID > ? ORDER BY h.ID',
          [n(h0?.['M'])],
          { teto: 10 },
        );
        await trein.corrigirParticipacao(s(), {
          treinamento: turma,
          vinculo: v.id,
          presenca: 'ausente',
          aproveitamento: null,
          conclusao: null,
          observacao: null,
          motivo: 'Presença sintética lançada no colaborador errado',
          versao: (await participante(v.id)).versao,
        });
        const t = await trein.turma(s(), turma);
        return {
          checkSemMotivo,
          estornado,
          ligarSemLanc,
          desfeito,
          apurado,
          r2Depois,
          comPresenca,
          retratos,
          turma: t,
        };
      });
      expect(r.checkSemMotivo).toBe('check');
      expect(r.estornado).toMatchObject({
        situacao: 'estornado',
        motivo: 'Plantão sintético aprovado por engano',
        por: 'SGH.COORD',
        realNoPlantao: false,
      });
      expect(r.ligarSemLanc.codigo).toBe('desatualizado');
      expect(r.desfeito).toMatchObject({ situacao: 'aprovado', motivo: null, realNoPlantao: true });
      expect(r.apurado.codigo).toBe('repasse-apurado');
      expect(r.apurado.bloqueios).toHaveLength(1);
      expect(r.r2Depois.situacao).toBe('aprovado');
      expect(r.comPresenca.codigo).toBe('inscricao-com-presenca');
      expect(r.retratos.map((x) => `${String(x['TABELA']).trim()} ${String(x['OPERACAO']).trim()}`)).toEqual([
        'SGH_PES_TREIN_PARTICIPANTE pessoas.retirarInscricao',
      ]);
      expect(r.turma.inicio).toBe('2026-02-12');
      expect(r.turma.lista.map((x) => x.presenca)).toEqual(['ausente']);
      expect(r.turma.correcoes?.map((c) => c.operacao).sort()).toEqual([
        'pessoas.participacao.corrigida',
        'pessoas.turma.alterada',
      ]);
      expect(r.turma.correcoes?.find((c) => c.operacao === 'pessoas.turma.alterada')).toMatchObject({
        antes: { inicio: '2026-02-10', cargaMin: 120 },
        depois: { inicio: '2026-02-12', cargaMin: 180 },
      });
      const final = await a.nucleo.desfazendoNaCopia({ ...a.c, traceId: 'int-w006-2-final' }, (e) =>
        contar(e),
      );
      expect(final).toEqual(antes);
      console.log(
        JSON.stringify({
          antes,
          final,
          apurado: r.apurado,
          estornado: r.estornado,
          correcoes: r.turma.correcoes?.length,
        }),
      );
    }, 600_000);
    it('correção cadastral do colaborador e versão do dependente (CHECKs, FK, folha conta pela data)', async () => {
      const TABELAS3 = [
        'SGH_PES_VINCULO',
        'SGH_PES_HISTORICO',
        'SGH_PES_DEPENDENTE',
        'SGH_PES_CORRECAO',
      ] as const;
      const contar = async (l: {
        consultar: (s: string, p: unknown[], o: { teto: number }) => Promise<Record<string, unknown>[]>;
      }) => {
        const r: Record<string, number> = {};
        for (const t of TABELAS3) {
          const [x] = await l.consultar(`SELECT COUNT(*) N FROM ${t}`, [], { teto: 1 });
          r[t] = n(x?.['N']);
        }
        return r;
      };
      const antes = await a.nucleo.desfazendoNaCopia({ ...a.c, traceId: 'int-w006-3-antes' }, (e) =>
        contar(e),
      );
      const r = await a.nucleo.desfazendoNaCopia({ ...a.c, traceId: 'int-w006-3-crud' }, async (e) => {
        const [cc] = await e.consultar(
          "SELECT FIRST 1 COD FROM TBCENCUS WHERE COALESCE(SITUACAO, 'A') <> 'I' ORDER BY COD",
          [],
          { teto: 1 },
        );
        const s0 = somenteSgh(e);
        const trilha = new RegistradorTrilhaMemoria();
        const servico = new ServicoPessoas(
          portaPessoasNaTransacao(e, a.executor),
          trilha,
          fonteConfiguracaoMemoria(trilha, {
            chavesIniciais: () => [chave('pessoas.colaborador')],
            prerequisitosIniciais: () => [cumprido('pessoas.colaborador')],
          }),
          null,
          new CifraCpf(Buffer.alloc(32, 66)),
        );
        let k = 0;
        const s = (): SessaoCadastro => ({
          req: {
            headers: { 'idempotency-key': `int-w006-3-${Date.now().toString(36)}-${++k}` },
            ip: '127.0.0.1',
            sgh: { sessao: { unidadeAtiva: null } },
          } as never,
          hospital: a.c.hospital,
          rede: a.c.rede,
          login: 'SGH.RH',
          porta: a.c,
          pode: () => true,
        });
        const MOTIVO = 'Erro de digitação na admissão (conferido no contrato)';
        const v = (
          await servico.admitir(s(), {
            cpf: cpfSintetico('900529061'),
            nome: 'CORRIGIDO SINTETICO W0-06',
            tipo: 'clt',
            admissao: '2026-01-05',
            cargo: 'Técnico de enfermagem',
            funcao: null,
            cargaSemanalHoras: 36,
            lotacao: { centroCusto: n(cc?.['COD']), unidade: null, setor: null },
            matricula: 'SINT-W006-1',
            profissional: null,
            usuario: null,
          })
        ).id;
        // 1. Correção cadastral: versão nova, linha 'correcao' no histórico e o valor anterior na SGH_PES_CORRECAO.
        await servico.corrigir(s(), {
          vinculo: v,
          versao: 0,
          nome: 'CORRIGIDO SINTETICO W0-06 UNO',
          matricula: 'SINT-W006-2',
          admissao: '2026-01-02',
          motivo: MOTIVO,
        });
        const f1 = await servico.ficha(s(), v);
        // O banco recusa a linha de correção sem motivo (CHECK do 1062).
        const checkCorrecao = await s0
          .executar(
            `INSERT INTO SGH_PES_HISTORICO (ID, HOSPITAL, ID_VINCULO, TIPO, VIGENCIA, MOTIVO, REGISTRADO_POR)
             VALUES (NEXT VALUE FOR SGH_GEN_PES_HISTORICO, ?, CAST(CAST(? AS VARCHAR(20)) AS BIGINT), 'correcao',
                     CURRENT_DATE, 'curto', 'SGH.TESTE')`,
            [a.c.hospital, String(v)],
          )
          .then(
            () => 'gravou',
            (x: unknown) =>
              /SGH_CK_PES_HISTORICO_CORR/.test(String((x as Error).message)) ? 'check' : String(x),
          );
        // 2. Dependente com versão a partir de uma data: a anterior acaba na véspera; a folha conta pela data.
        const d = (
          await servico.incluirDependente(s(), {
            vinculo: v,
            nome: 'FILHO SINTETICO W0-06',
            nascimento: '2020-05-10',
            parentesco: '03',
            cpf: cpfSintetico('900529062'),
            dependenteIr: false,
            dependenteSalarioFamilia: false,
          })
        ).id;
        const d2 = (
          await servico.alterarDependente(s(), {
            vinculo: v,
            dependente: d,
            desde: '2026-03-01',
            dependenteIr: true,
            motivo: 'Marca do IR esquecida na inclusão',
          })
        ).id;
        const versoes = await e.consultar(
          `SELECT CAST(ID AS VARCHAR(20)) ID, CAST(ATE AS VARCHAR(10)) ATE, CAST(DESDE AS VARCHAR(10)) DESDE,
                  CAST(ID_ANTERIOR AS VARCHAR(20)) ANT, DEP_IR, MOTIVO_FIM
             FROM SGH_PES_DEPENDENTE WHERE ID_VINCULO = CAST(CAST(? AS VARCHAR(20)) AS BIGINT) ORDER BY ID`,
          [String(v)],
          { teto: 5 },
        );
        const folha = async (data: string) =>
          (await dependentesDaFolhaPesSgh(e, a.c.hospital, [v], data)).get(v) ?? {
            irrf: 0,
            salarioFamilia: 0,
          };
        const fev = await folha('2026-02-15');
        const mar = await folha('2026-03-15');
        const vespera = await folha('2026-02-28');
        // O banco recusa versão sem data, segunda versão da mesma anterior e anterior inexistente.
        const bruto = (desde: string | null, ant: string) =>
          s0
            .executar(
              `INSERT INTO SGH_PES_DEPENDENTE (ID, HOSPITAL, ID_VINCULO, NOME, NASCIMENTO, PARENTESCO, DEP_IR, DEP_SF,
                 DESDE, ID_ANTERIOR, CRIADO_POR)
               VALUES (NEXT VALUE FOR SGH_GEN_PES_DEPENDENTE, ?, CAST(CAST(? AS VARCHAR(20)) AS BIGINT), 'X SINT',
                 DATE '2020-05-10', '03', 'F', 'F', CAST(CAST(? AS VARCHAR(10)) AS DATE),
                 CAST(CAST(? AS VARCHAR(20)) AS BIGINT), 'SGH.TESTE')`,
              [a.c.hospital, String(v), desde, ant],
            )
            .then(
              () => 'gravou',
              (x: unknown) => {
                const m = String((x as Error).message);
                return (/SGH_CK_PES_DEPENDENTE_VERSAO|SGH_UX_PES_DEPENDENTE_ANT|SGH_FK_PES_DEPENDENTE_ANT/.exec(
                  m,
                ) ?? [m])[0];
              },
            );
        const semDesde = await bruto(null, String(d));
        const dupla = await bruto('2026-04-01', String(d));
        const orfa = await bruto('2026-04-01', '999999999999');
        const checkDesde = await s0
          .executar(
            `UPDATE SGH_PES_DEPENDENTE SET ATE = DATE '2026-02-01', MOTIVO_FIM = 'Fim sintetico antes do inicio',
               ENCERRADO_POR = 'SGH.TESTE' WHERE ID = CAST(CAST(? AS VARCHAR(20)) AS BIGINT)`,
            [String(d2)],
          )
          .then(
            () => 'gravou',
            (x: unknown) =>
              /SGH_CK_PES_DEPENDENTE_DESDE/.test(String((x as Error).message)) ? 'check' : String(x),
          );
        const f2 = await servico.ficha(s(), v);
        return {
          f1,
          checkCorrecao,
          d,
          d2,
          versoes,
          fev,
          mar,
          vespera,
          semDesde,
          dupla,
          orfa,
          checkDesde,
          f2,
        };
      });
      expect(r.f1).toMatchObject({
        versao: 1,
        nome: 'CORRIGIDO SINTETICO W0-06 UNO',
        matricula: 'SINT-W006-2',
        admissao: '2026-01-02',
      });
      expect(r.f1.historico.find((x) => x.tipo === 'correcao')).toMatchObject({ registradoPor: 'SGH.RH' });
      expect(r.f1.correcoes?.[0]).toMatchObject({
        operacao: 'colaborador.corrigido',
        antes: { nome: 'CORRIGIDO SINTETICO W0-06', matricula: 'SINT-W006-1', admissao: '2026-01-05' },
      });
      expect(r.checkCorrecao).toBe('check');
      expect(
        r.versoes.map((x) => [
          n(x['ID']),
          x['ATE'],
          x['DESDE'],
          x['ANT'] === null ? null : n(x['ANT']),
          x['DEP_IR'],
        ]),
      ).toEqual([
        [r.d, '2026-02-28', null, null, 'F'],
        [r.d2, null, '2026-03-01', r.d, 'T'],
      ]);
      expect(String(r.versoes[0]?.['MOTIVO_FIM'])).toMatch(/^Alterado \(nova versão\)/);
      expect([r.fev.irrf, r.vespera.irrf, r.mar.irrf]).toEqual([0, 0, 1]);
      expect(r.semDesde).toBe('SGH_CK_PES_DEPENDENTE_VERSAO');
      expect(r.dupla).toBe('SGH_UX_PES_DEPENDENTE_ANT');
      expect(r.orfa).toBe('SGH_FK_PES_DEPENDENTE_ANT');
      expect(r.checkDesde).toBe('check');
      expect(r.f2.dependentes.map((x) => [x.id, x.desde, x.dependenteIr])).toEqual([
        [r.d2, '2026-03-01', true],
      ]);
      expect(r.f2.correcoes?.map((c) => c.operacao).sort()).toEqual([
        'colaborador.corrigido',
        'dependente.alterado',
      ]);
      const final = await a.nucleo.desfazendoNaCopia({ ...a.c, traceId: 'int-w006-3-final' }, (e) =>
        contar(e),
      );
      expect(final).toEqual(antes);
      console.log(
        JSON.stringify({ antes, final, versoes: r.versoes.length, folha: [r.fev, r.vespera, r.mar] }),
      );
    }, 600_000);

    it('SESMT: retificação e anulação do acidente e da CAT com a fila do eSocial (original guardado, nada sai do dev) e cancelamento do EPI', async () => {
      const TABELAS4 = [
        'SGH_PES_ACIDENTE',
        'SGH_PES_EPI_ENTREGA',
        'SGH_PES_CORRECAO',
        'SGH_PES_ESOCIAL_EVENTO',
        'SGH_PES_ESOCIAL_LOTE',
        'SGH_PES_ESOCIAL_EMPREGADOR',
        'SGH_PES_ESOCIAL_FICHA',
        'SGH_PES_VINCULO',
      ] as const;
      const LEGADAS4 = ['STCAT', 'FPFUNC', 'FPESOCPEND', 'FPESOCSITENVEVE'] as const;
      const contar = async (l: {
        consultar: (s: string, p: unknown[], o: { teto: number }) => Promise<Record<string, unknown>[]>;
      }) => {
        const r: Record<string, number> = {};
        for (const t of [...TABELAS4, ...LEGADAS4]) {
          const [x] = await l.consultar(`SELECT COUNT(*) N FROM ${t}`, [], { teto: 1 });
          r[t] = n(x?.['N']);
        }
        return r;
      };
      const antes = await a.nucleo.desfazendoNaCopia({ ...a.c, traceId: 'int-w006-4-antes' }, (e) =>
        contar(e),
      );
      const r = await a.nucleo.desfazendoNaCopia({ ...a.c, traceId: 'int-w006-4-sesmt' }, async (e) => {
        const legadoAntes = await contar(e);
        const [cc] = await e.consultar(
          "SELECT FIRST 1 COD FROM TBCENCUS WHERE COALESCE(SITUACAO, 'A') <> 'I' ORDER BY COD",
          [],
          { teto: 1 },
        );
        const [h] = await e.consultar(
          'SELECT CAST(CURRENT_DATE - 1 AS VARCHAR(10)) H FROM RDB$DATABASE',
          [],
          {
            teto: 1,
          },
        );
        const ontem = String(h?.['H']);
        const cifra = new CifraCpf(Buffer.alloc(32, 77));
        const CPF = '52998224725'; // sintético, dígitos válidos (não é de pessoa real)
        const v = await incluirVinculoPesSgh(somenteSgh(e), {
          hospital: a.c.hospital,
          pessoa: null,
          cpfHmac: cifra.hmac(CPF),
          cpfCifrado: cifra.cifrar(CPF),
          nome: 'COLABORADORA SINTETICA W0-06 SESMT',
          profissional: null,
          usuario: null,
          tipo: 'clt',
          matricula: `SW006-${Date.now().toString(36)}`,
          cargo: 'Técnico de enfermagem',
          funcao: null,
          cargaSemanal: 36,
          centroCusto: n(cc?.['COD']),
          unidade: null,
          setor: null,
          admissao: '2026-01-05',
          por: 'SGH.TESTE',
        });
        const ctx = { rede: a.c.rede, hospital: a.c.hospital };
        const folha = portaFolhaNaTransacao(e);
        const empresa = (await folha.empresas(ctx))[0]!.codigo;
        const trilha = new RegistradorTrilhaMemoria();
        const recursos = ['pessoas.colaborador', 'pessoas.folha', 'pessoas.esocial', 'pessoas.sesmt'];
        const config = fonteConfiguracaoMemoria(trilha, {
          chavesIniciais: () => recursos.map(chave),
          prerequisitosIniciais: () => recursos.map(cumprido),
        });
        const pessoas = portaPessoasNaTransacao(e, a.executor);
        // Ambiente 'dev' e nenhum transmissor: o lote vai ao coletor; nada sai.
        const esocial = new ServicoEsocial(
          portaEsocialNaTransacao(e),
          folha,
          portaCalculoFolhaNaTransacao(e),
          portaRubricasNaTransacao(e),
          pessoas,
          cifra,
          trilha,
          config,
          null,
          'dev',
        );
        const sesmt = new ServicoSesmt(portaSesmtNaTransacao(e), pessoas, trilha, config, null, esocial);
        let k = 0;
        const s = (): SessaoCadastro => ({
          req: {
            headers: { 'idempotency-key': `int-w006-4-${Date.now().toString(36)}-${++k}` },
            ip: '127.0.0.1',
            sgh: { sessao: { unidadeAtiva: null } },
          } as never,
          hospital: a.c.hospital,
          rede: a.c.rede,
          login: 'SGH.SESMT',
          porta: ctx,
          pode: () => true,
        });
        const apoioEs = await esocial.apoioTela(s());
        const temCnpj = apoioEs.empresas.find((x) => x.codigo === empresa)?.temCnpj ?? false;
        await esocial.registrarEmpregador(s(), {
          empresa,
          inicio: '2026-01',
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
        await esocial.registrarFicha(s(), v.id, { ficha: FICHA_W006, versao: null });
        // Códigos das tabelas do eSocial da cópia: só os de 9 dígitos (o leiaute exige).
        const apoio = await sesmt.apoioTela(s());
        const nove = (xs: readonly { codigo: number }[]) =>
          xs.find((x) => String(x.codigo).length === 9)?.codigo ?? null;
        const cod = {
          parte: nove(apoio.dominios.partesCorpo),
          parte2: apoio.dominios.partesCorpo.filter((x) => String(x.codigo).length === 9)[1]?.codigo ?? null,
          natureza: nove(apoio.dominios.naturezas),
          agente: nove(apoio.dominios.agentes),
          situacao: nove(apoio.dominios.situacoes),
          tamanhos: {
            partes: apoio.dominios.partesCorpo.length,
            naturezas: apoio.dominios.naturezas.length,
            agentes: apoio.dominios.agentes.length,
            situacoes: apoio.dominios.situacoes.length,
            fora9: [
              ...apoio.dominios.partesCorpo,
              ...apoio.dominios.naturezas,
              ...apoio.dominios.agentes,
              ...apoio.dominios.situacoes,
            ].filter((x) => String(x.codigo).length !== 9).length,
          },
        };
        const CAT = {
          horasAntes: '0530',
          lateralidade: 2 as const,
          comunicouPolicia: false,
          dataObito: null,
          ultimoDiaTrabalhado: null,
          observacao: null,
          reciboOrigem: null,
          localTipo: 1 as const,
          logradouro: 'Rua Sintetica do Hospital',
          numero: '100',
          cep: '30110000',
          municipio: '3106200',
          uf: 'MG',
          atestadoData: ontem,
          atestadoHora: '1500',
          internacao: false,
          duracaoDias: 2,
          complementoLesao: null,
          diagnostico: null,
          cid: 'W260',
          emitenteNome: 'MEDICA SINTETICA',
          emitenteConselho: 1 as const,
          emitenteNumero: '12345',
          emitenteUf: 'MG',
        };
        const acid = await sesmt.registrarAcidente(s(), {
          vinculo: v.id,
          ocorridoEm: `${ontem}T08:00`,
          tipo: 'tipico',
          unidade: null,
          local: 'Posto de enfermagem sintetico',
          descricao: 'Corte no dedo ao abrir ampola, cenario sintetico.',
          biologico: false,
          perfurocortante: false,
          exposicao: null,
          material: null,
          fonte: null,
          fonteTeste: null,
          parteCorpo: cod.parte,
          natureza: cod.natureza,
          agente: cod.agente,
          situacao: cod.situacao,
          afastamento: false,
          obito: false,
          profilaxia: null,
          profilaxiaEm: null,
          profilaxiaObs: null,
        } as never);
        const id = acid.id;
        await sesmt.emitirCat(s(), {
          acidente: id,
          versao: (await sesmt.acidente(s(), id)).versao,
          tipoCat: 1,
          iniciativa: 1,
          numero: `SINT-CAT-W006-${id}`,
          emitidaEm: ontem,
          cat: CAT,
        });
        const previa = await sesmt.gerarCatEsocial(s(), { acidente: id, empresa, gravar: false });
        const p0 = previa.eventos[0]!;
        const out: Record<string, unknown> = {
          temCnpj,
          cod,
          previa: {
            valido: p0.valido,
            pend: p0.pendencias.map((x) => x.codigo),
            xsd: p0.errosXsd.slice(0, 3),
          },
        };
        const retificar = async (motivo: string, lateralidade: 1 | 3, parte: number | null) => {
          const ac = await sesmt.acidente(s(), id);
          return sesmt.retificarAcidente(s(), {
            acidente: id,
            versao: ac.versao,
            motivo,
            ocorridoEm: ac.ocorridoEm,
            tipo: 'tipico',
            local: 'Posto 3 sintetico',
            descricao: 'Corte no dedo ao abrir ampola de medicacao (retificado).',
            parteCorpo: parte,
            natureza: ac.natureza,
            agente: ac.agente,
            situacao: ac.situacao,
            afastamento: false,
            obito: false,
            cat: { ...CAT, lateralidade },
          });
        };
        const xmlDe = async (ev: number) => (await esocial.detalheEvento(s(), ev)).xml ?? '';
        const situacaoDe = async (ev: number) => (await esocial.detalheEvento(s(), ev)).evento.situacao;
        if (p0.pendencias.length === 0 && p0.valido) {
          // 1) Original na fila; retificação antes de enviar: o original se descarta (guardado) e sai outro original.
          const original0 = (await sesmt.gerarCatEsocial(s(), { acidente: id, empresa, gravar: true }))
            .eventos[0]!.id!;
          const r0 = await retificar('Local do acidente registrado errado no plantao', 1, cod.parte);
          out['r0'] = r0.esocial;
          out['original0'] = await situacaoDe(original0);
          const original = r0.esocial!.evento!;
          // 2) Lote ao coletor (dev; nenhum transmissor) e o retorno aceito sintético com o recibo.
          const lote = await esocial.montarLote(s(), { empresa, eventos: [original] });
          const enviado = await esocial.enviarLote(s(), lote.lote.id, { versao: lote.lote.versao });
          out['lote'] = {
            ambiente: enviado.lote.ambiente,
            situacao: enviado.lote.situacao,
            protocolo: enviado.lote.protocolo,
          };
          await esocial.registrarRetorno(s(), lote.lote.id, {
            versao: enviado.lote.versao,
            protocolo: null,
            eventos: [
              {
                evento: original,
                aceito: true,
                recibo: '1.2.0000000000000000963',
                codigo: '201',
                descricao: 'Sucesso (retorno sintetico)',
              },
            ],
          });
          // 3) Retificação do aceito: o S-2210 retificador (indRetif 2 com o recibo); o original fica aceito.
          const r1 = await retificar('Parte do corpo atingida registrada errada', 3, cod.parte2 ?? cod.parte);
          out['r1'] = r1.esocial;
          const retificador = r1.esocial!.evento!;
          const x1 = await xmlDe(retificador);
          out['xmlRet'] = {
            indRetif2: x1.includes('<indRetif>2</indRetif><nrRecibo>1.2.0000000000000000963</nrRecibo>'),
            lateralidade3: x1.includes('<lateralidade>3</lateralidade>'),
          };
          out['originalDepoisRet'] = await situacaoDe(original);
          // 4) Anulação: o retificador não enviado se descarta; o aceito ganha o S-3000 com o recibo.
          const ac = await sesmt.acidente(s(), id);
          const an = await sesmt.anularAcidente(s(), {
            acidente: id,
            versao: ac.versao,
            motivo: 'Acidente lancado no colaborador errado',
          });
          out['an'] = an.esocial;
          const exc = await esocial.detalheEvento(s(), an.esocial!.evento!);
          out['s3000'] = {
            evento: exc.evento.evento,
            anterior: exc.evento.eventoAnterior,
            recibo: (exc.xml ?? '').includes('<nrRecEvt>1.2.0000000000000000963</nrRecEvt>'),
          };
          out['fila'] = (await esocial.eventosCat(s(), id)).map((x) => [x.id, x.situacao]);
          out['ids'] = { original0, original, retificador };
          // O banco guarda tudo: nenhuma linha do S-2210 some.
          const [q] = await e.consultar(
            "SELECT COUNT(*) N FROM SGH_PES_ESOCIAL_EVENTO WHERE EVENTO = 'S-2210' AND ORIGEM = 'acidente' AND REFERENCIA = ?",
            [id],
            { teto: 1 },
          );
          out['s2210Guardados'] = n(q?.['N']);
        } else {
          // Sem os dados do empregador na cópia: a retificação local segue, sem fila.
          const r0 = await retificar('Local do acidente registrado errado no plantao', 1, cod.parte);
          out['r0'] = r0.esocial;
          const ac = await sesmt.acidente(s(), id);
          out['an'] = (
            await sesmt.anularAcidente(s(), {
              acidente: id,
              versao: ac.versao,
              motivo: 'Acidente lancado no colaborador errado',
            })
          ).esocial;
        }
        const anulado = await sesmt.acidente(s(), id);
        out['anulado'] = {
          estado: anulado.estado,
          anuladoPor: anulado.anuladoPor,
          motivo: anulado.motivoEncerramento,
        };
        // O banco recusa a anulação sem motivo (SGH_CK_PES_ACID_ANULADO).
        out['ckAnulado'] = await e
          .executar(
            "UPDATE SGH_PES_ACIDENTE SET ANULADO_EM = CURRENT_TIMESTAMP, ANULADO_POR = 'X', MOTIVO_ENCERRA = 'curto' WHERE ID = ?",
            [id],
          )
          .then(
            () => 'aceitou',
            (x: unknown) =>
              /SGH_CK_PES_ACID_ANULADO/.test(String((x as Error).message))
                ? 'SGH_CK_PES_ACID_ANULADO'
                : String((x as Error).message).slice(0, 200),
          );
        // EPI: entrega e cancelamento com motivo; o banco recusa o cancelamento sem motivo.
        const entrega = await sesmt.registrarEpi(s(), {
          tipo: 'epi',
          vinculo: v.id,
          data: ontem,
          epi: 'Luva de procedimento',
          caNumero: '12345',
          caValidade: '2030-12-31',
          quantidade: 2,
          observacao: null,
        } as never);
        out['ckEpi'] = await e
          .executar(
            'UPDATE SGH_PES_EPI_ENTREGA SET CANCELADO_EM = CURRENT_TIMESTAMP, CANCELADO_POR = ? WHERE ID = ?',
            ['X', entrega.id],
          )
          .then(
            () => 'aceitou',
            (x: unknown) =>
              /SGH_CK_PES_EPI_CANCELADA2/.test(String((x as Error).message))
                ? 'SGH_CK_PES_EPI_CANCELADA2'
                : String((x as Error).message).slice(0, 200),
          );
        await sesmt.cancelarEpi(s(), {
          entrega: entrega.id,
          motivo: 'Entrega registrada no colaborador errado',
        });
        const [ep] = await e.consultar(
          'SELECT CANCELADO_POR, MOTIVO_CANCELA FROM SGH_PES_EPI_ENTREGA WHERE ID = ?',
          [entrega.id],
          { teto: 1 },
        );
        out['epi'] = [ep?.['CANCELADO_POR'], ep?.['MOTIVO_CANCELA']];
        out['epiDeNovo'] = (
          await erro(
            sesmt.cancelarEpi(s(), {
              entrega: entrega.id,
              motivo: 'Entrega registrada no colaborador errado',
            }),
          )
        ).codigo;
        // O banco recusa S-2210 fora do CHECK? Não: o CHECK novo aceita S-2210 e recusa evento inventado.
        out['ckEvento'] = await e
          .executar(
            "UPDATE SGH_PES_ESOCIAL_EVENTO SET EVENTO = 'S-9999' WHERE REFERENCIA = ? AND ORIGEM = 'acidente'",
            [id],
          )
          .then(
            (x) => `aceitou ${String(x)}`,
            (x: unknown) =>
              /SGH_CK_PES_ESOCIAL_EVT_EVENTO3/.test(String((x as Error).message))
                ? 'SGH_CK_PES_ESOCIAL_EVT_EVENTO3'
                : String((x as Error).message).slice(0, 200),
          );
        const [cor] = await e.consultar(
          "SELECT COUNT(*) N FROM SGH_PES_CORRECAO WHERE (TABELA = 'SGH_PES_ACIDENTE' AND ID_REGISTRO = ?) OR (TABELA = 'SGH_PES_EPI_ENTREGA' AND ID_REGISTRO = ?)",
          [id, entrega.id],
          { teto: 1 },
        );
        out['correcoes'] = n(cor?.['N']);
        const depois = await contar(e);
        out['legado'] = LEGADAS4.map((t) => [t, legadoAntes[t], depois[t]]);
        return out;
      });
      console.log(JSON.stringify(r));
      const final = await a.nucleo.desfazendoNaCopia({ ...a.c, traceId: 'int-w006-4-final' }, (e) =>
        contar(e),
      );
      expect(final).toEqual(antes);
      for (const [t, x, y] of r['legado'] as [string, number, number][]) expect(y, t).toBe(x);
      const cod = r['cod'] as { tamanhos: { fora9: number } };
      expect(cod.tamanhos.fora9).toBe(0);
      expect(r['anulado']).toMatchObject({
        estado: 'encerrado',
        anuladoPor: 'SGH.SESMT',
        motivo: 'Acidente lancado no colaborador errado',
      });
      expect(r['ckAnulado']).toBe('SGH_CK_PES_ACID_ANULADO');
      expect(r['ckEpi']).toBe('SGH_CK_PES_EPI_CANCELADA2');
      expect(r['epi']).toEqual(['SGH.SESMT', 'Entrega registrada no colaborador errado']);
      expect(r['epiDeNovo']).toBe('ja-cancelada');
      expect(r['correcoes']).toBe(r['temCnpj'] && r['ids'] ? 4 : 3);
      expect(r['previa']).toMatchObject({ pend: expect.any(Array) });
      // Com o CNPJ do empregador na cópia, o caminho da fila é obrigatório.
      expect(Boolean(r['ids'])).toBe(Boolean(r['temCnpj']));
      if (!r['ids']) return;
      const ids = r['ids'] as { original0: number; original: number; retificador: number };
      expect(r['ckEvento']).toBe('SGH_CK_PES_ESOCIAL_EVT_EVENTO3');
      expect(r['original0']).toBe('descartado');
      expect(r['r0']).toMatchObject({ operacao: 'original', anterior: ids.original0, valido: true });
      expect(r['lote']).toMatchObject({ ambiente: 'coletor' });
      expect(r['r1']).toMatchObject({ operacao: 'retificacao', anterior: ids.original, valido: true });
      expect(r['xmlRet']).toEqual({ indRetif2: true, lateralidade3: true });
      expect(r['originalDepoisRet']).toBe('aceito');
      expect(r['an']).toMatchObject({ operacao: 'exclusao', anterior: ids.original, valido: true });
      expect(r['s3000']).toEqual({ evento: 'S-3000', anterior: ids.original, recibo: true });
      expect((r['fila'] as [number, string][]).slice().sort((x, y) => x[0] - y[0])).toEqual([
        [ids.original0, 'descartado'],
        [ids.original, 'aceito'],
        [ids.retificador, 'descartado'],
      ]);
      expect(r['s2210Guardados']).toBe(3);
    }, 600_000);

    it('revisão W0-06: correção de matrícula ou admissão com o S-2200 na fila (descarte do não enviado, retificador, S-3000, em lote recusa) e a busca do estorno lançado', async () => {
      const r = await a.nucleo.desfazendoNaCopia({ ...a.c, traceId: 'int-w006-rev-s2200' }, async (e) => {
        const out: Record<string, unknown> = {};
        // A busca do negativo já lançado (conciliação do estorno pendente): o SQL roda na cópia.
        out['estornoLancado'] = await estornoLancadoDoRealizadoPesSgh(e, {
          hospital: a.c.hospital,
          id: 999_999_999,
          original: 999_999_999,
        });
        const [cc] = await e.consultar(
          "SELECT FIRST 1 COD FROM TBCENCUS WHERE COALESCE(SITUACAO, 'A') <> 'I' ORDER BY COD",
          [],
          { teto: 1 },
        );
        const cifra = new CifraCpf(Buffer.alloc(32, 78));
        const CPF = '39053344705'; // sintético, dígitos válidos (não é de pessoa real)
        const v = await incluirVinculoPesSgh(somenteSgh(e), {
          hospital: a.c.hospital,
          pessoa: null,
          cpfHmac: cifra.hmac(CPF),
          cpfCifrado: cifra.cifrar(CPF),
          nome: 'COLABORADORA SINTETICA W0-06 S2200',
          profissional: null,
          usuario: null,
          tipo: 'clt',
          matricula: `RW006-${Date.now().toString(36)}`.slice(0, 20),
          cargo: 'Técnico de enfermagem',
          funcao: null,
          cargaSemanal: 36,
          centroCusto: n(cc?.['COD']),
          unidade: null,
          setor: null,
          admissao: '2026-01-05',
          por: 'SGH.TESTE',
        });
        await incluirSalarioPesSgh(somenteSgh(e), {
          hospital: a.c.hospital,
          vinculo: v.id,
          inicio: '2026-01-01',
          salario: 320_000,
          insalubridade: 0,
          periculosidade: false,
          motivo: 'Salario de admissao sintetico',
          por: 'SGH.TESTE',
        });
        const ctx = { rede: a.c.rede, hospital: a.c.hospital };
        const folha = portaFolhaNaTransacao(e);
        const empresa = (await folha.empresas(ctx))[0]!.codigo;
        const trilha = new RegistradorTrilhaMemoria();
        const recursos = ['pessoas.colaborador', 'pessoas.folha', 'pessoas.esocial'];
        const config = fonteConfiguracaoMemoria(trilha, {
          chavesIniciais: () => recursos.map(chave),
          prerequisitosIniciais: () => recursos.map(cumprido),
        });
        const pessoas = portaPessoasNaTransacao(e, a.executor);
        const esocial = new ServicoEsocial(
          portaEsocialNaTransacao(e),
          folha,
          portaCalculoFolhaNaTransacao(e),
          portaRubricasNaTransacao(e),
          pessoas,
          cifra,
          trilha,
          config,
          null,
          'dev',
        );
        const rh = new ServicoPessoas(pessoas, trilha, config, null, cifra, esocial);
        let k = 0;
        const s = (): SessaoCadastro => ({
          req: {
            headers: { 'idempotency-key': `int-w006-rev-${Date.now().toString(36)}-${++k}` },
            ip: '127.0.0.1',
            sgh: { sessao: { unidadeAtiva: null } },
          } as never,
          hospital: a.c.hospital,
          rede: a.c.rede,
          login: 'SGH.RH',
          porta: ctx,
          pode: () => true,
        });
        const apoioEs = await esocial.apoioTela(s());
        out['temCnpj'] = apoioEs.empresas.find((x) => x.codigo === empresa)?.temCnpj ?? false;
        if (!out['temCnpj']) return out;
        await esocial.registrarEmpregador(s(), {
          empresa,
          inicio: '2026-01',
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
        await esocial.registrarFicha(s(), v.id, { ficha: FICHA_W006, versao: null });
        const versao = async () => (await rh.ficha(s(), v.id)).versao;
        const xmlDe = async (id: number) => (await esocial.detalheEvento(s(), id)).xml ?? '';
        const situacaoDe = async (id: number) => (await esocial.detalheEvento(s(), id)).evento.situacao;
        const g0 = await esocial.gerarTrabalhador(s(), {
          evento: 'S-2200',
          empresa,
          vinculo: v.id,
          referencia: null,
          data: null,
          retificar: null,
          gravar: true,
        });
        out['g0'] = g0.eventos[0]!.pendencias;
        const original0 = g0.eventos[0]!.id!;
        // 1) Não enviado + matrícula: descarta e gera de novo com a matrícula corrigida.
        const r0 = await rh.corrigir(s(), {
          vinculo: v.id,
          versao: await versao(),
          matricula: 'RW006-CERTA',
          motivo: 'Matricula digitada errada na admissao',
        });
        out['r0'] = r0.esocial;
        out['original0'] = await situacaoDe(original0);
        const original = r0.esocial!.evento!;
        out['xml0'] = (await xmlDe(original)).includes('<matricula>RW006-CERTA</matricula>');
        // 2) Em lote: a correção recusa e nada muda.
        const lote = await esocial.montarLote(s(), { empresa, eventos: [original] });
        const v1 = await versao();
        out['emLote'] = await rh
          .corrigir(s(), {
            vinculo: v.id,
            versao: v1,
            admissao: '2026-01-02',
            motivo: 'Admissao com a data errada',
          })
          .then(
            () => 'ok',
            (x: unknown) => (x as ErroProblema).extras?.['codigo'] ?? String(x),
          );
        out['versaoIntacta'] = (await versao()) === v1;
        const enviado = await esocial.enviarLote(s(), lote.lote.id, { versao: lote.lote.versao });
        await esocial.registrarRetorno(s(), lote.lote.id, {
          versao: enviado.lote.versao,
          protocolo: null,
          eventos: [
            {
              evento: original,
              aceito: true,
              recibo: '1.2.0000000000000000971',
              codigo: '201',
              descricao: 'Sucesso (retorno sintetico)',
            },
          ],
        });
        // 3) Aceito + admissão: o retificador (indRetif 2 com o recibo) na mesma operação.
        const r1 = await rh.corrigir(s(), {
          vinculo: v.id,
          versao: await versao(),
          admissao: '2026-01-02',
          motivo: 'Admissao com a data errada',
        });
        out['r1'] = r1.esocial;
        const x1 = await xmlDe(r1.esocial!.evento!);
        out['xmlRet'] = {
          indRetif2: x1.includes('<indRetif>2</indRetif><nrRecibo>1.2.0000000000000000971</nrRecibo>'),
          dtAdm: x1.includes('<dtAdm>2026-01-02</dtAdm>'),
        };
        // 4) Aceito + matrícula: o retificador não enviado se descarta e o aceito ganha o S-3000.
        const r2 = await rh.corrigir(s(), {
          vinculo: v.id,
          versao: await versao(),
          matricula: 'RW006-FINAL',
          motivo: 'Matricula trocada com a de outro colaborador',
        });
        out['r2'] = r2.esocial;
        out['retificador'] = await situacaoDe(r1.esocial!.evento!);
        const exc = await esocial.detalheEvento(s(), r2.esocial!.evento!);
        out['s3000'] = {
          evento: exc.evento.evento,
          recibo: (exc.xml ?? '').includes('<nrRecEvt>1.2.0000000000000000971</nrRecEvt>'),
        };
        out['ids'] = { original0, original, retificador: r1.esocial!.evento! };
        return out;
      });
      expect(r['estornoLancado']).toBeNull();
      if (!r['temCnpj']) return;
      const ids = r['ids'] as { original0: number; original: number; retificador: number };
      expect(r['g0']).toEqual([]);
      expect(r['r0']).toMatchObject({ operacao: 'original', anterior: ids.original0, valido: true });
      expect(r['original0']).toBe('descartado');
      expect(r['xml0']).toBe(true);
      expect(r['emLote']).toBe('evento-em-transito');
      expect(r['versaoIntacta']).toBe(true);
      expect(r['r1']).toMatchObject({ operacao: 'retificacao', anterior: ids.original, valido: true });
      expect(r['xmlRet']).toEqual({ indRetif2: true, dtAdm: true });
      expect(r['r2']).toMatchObject({ operacao: 'exclusao', anterior: ids.original, valido: true });
      expect(r['retificador']).toBe('descartado');
      expect(r['s3000']).toEqual({ evento: 'S-3000', recibo: true });
    }, 600_000);

    it('cargos e salários: inclusão, alteração com o valor anterior, versão da faixa e da vaga, 409 do cargo referenciado com a inativação e exclusão do nunca usado com retrato', async () => {
      const TABELAS4 = [
        'SGH_PES_CARGO',
        'SGH_PES_CARGO_FAIXA',
        'SGH_PES_VAGA',
        'SGH_PES_VINCULO',
        'SGH_PES_HISTORICO',
        'SGH_PES_CORRECAO',
        'SGH_HIST_EXCLUSAO',
        'FPCARGO',
      ] as const;
      const contar = async (l: {
        consultar: (s: string, p: unknown[], o: { teto: number }) => Promise<Record<string, unknown>[]>;
      }) => {
        const r: Record<string, number> = {};
        for (const t of TABELAS4) {
          const [x] = await l.consultar(`SELECT COUNT(*) N FROM ${t}`, [], { teto: 1 });
          r[t] = n(x?.['N']);
        }
        return r;
      };
      const antes = await a.nucleo.desfazendoNaCopia({ ...a.c, traceId: 'int-w006-4-antes' }, (e) =>
        contar(e),
      );
      const r = await a.nucleo.desfazendoNaCopia({ ...a.c, traceId: 'int-w006-4-crud' }, async (e) => {
        const s0 = somenteSgh(e);
        const [cc] = await e.consultar(
          "SELECT FIRST 1 COD FROM TBCENCUS WHERE COALESCE(SITUACAO, 'A') <> 'I' ORDER BY COD",
          [],
          { teto: 1 },
        );
        const [cbo] = await e.consultar(
          "SELECT FIRST 1 COD FROM TBCBOSUS WHERE COD IN ('223505', '322205') OR COD STARTING WITH '2235' ORDER BY CASE WHEN COD = '223505' THEN 0 ELSE 1 END, COD",
          [],
          { teto: 1 },
        );
        const trilha = new RegistradorTrilhaMemoria();
        const config = fonteConfiguracaoMemoria(trilha, {
          chavesIniciais: () => [chave('pessoas.colaborador')],
          prerequisitosIniciais: () => [cumprido('pessoas.colaborador')],
        });
        const pessoas = portaPessoasNaTransacao(e, a.executor);
        const porta = portaCargosNaTransacao(e);
        const svc = new ServicoCargos(porta, pessoas, trilha, config, null);
        const servicoPessoas = new ServicoPessoas(
          pessoas,
          trilha,
          config,
          null,
          new CifraCpf(Buffer.alloc(32, 66)),
        );
        let k = 0;
        const s = (): SessaoCadastro => ({
          req: {
            headers: { 'idempotency-key': `int-w006-4-${Date.now().toString(36)}-${++k}` },
            ip: '127.0.0.1',
            sgh: { sessao: { unidadeAtiva: null } },
          } as never,
          hospital: a.c.hospital,
          rede: a.c.rede,
          login: 'SGH.RH',
          porta: a.c,
          pode: () => true,
        });
        const MOTIVO = 'Lançado com o dado errado na implantação';
        const conselhos = await porta.conselhos(a.c);
        const conselho =
          conselhos.find((x) => /COREN/i.test(`${x.codigo} ${x.rotulo}`))?.codigo ??
          conselhos[0]?.codigo ??
          null;
        const CARGO = {
          nome: 'CARGO SINTETICO W0-06',
          cbo: String(cbo?.['COD']).trim(),
          descricao: 'Cargo da integração sintética',
          requisitos: 'Nenhum',
          conselho,
        };
        // 1. Inclusão e alteração com motivo (o valor anterior na SGH_PES_CORRECAO).
        const { id: cargo } = await svc.incluirCargo(s(), CARGO);
        const v0 = (await svc.ficha(s(), cargo)).cargo.versao;
        await svc.alterarCargo(s(), {
          ...CARGO,
          nome: 'CARGO SINTETICO W0-06 UTI',
          cargo,
          versao: v0,
          motivo: MOTIVO,
        });
        // 2. Faixa salarial e vaga do quadro: inclusão e versão nova a partir de uma data.
        const { id: faixa } = await svc.incluirFaixa(s(), {
          cargo,
          faixa: 'A',
          nivel: 'I',
          valor: 450_000,
          desde: '2026-01-01',
        });
        const fx0 = (await svc.ficha(s(), cargo)).faixas.find((x) => x.id === faixa)!;
        const { id: faixa2 } = await svc.versaoFaixa(s(), {
          faixa,
          versao: fx0.versao,
          valor: 480_000,
          desde: '2026-12-01',
          motivo: MOTIVO,
        });
        const { id: vaga } = await svc.incluirVaga(s(), {
          cargo,
          centroCusto: n(cc?.['COD']),
          quantidade: 3,
          desde: '2026-01-01',
        });
        const vg0 = (await svc.ficha(s(), cargo)).vagas.find((x) => x.id === vaga)!;
        const { id: vaga2 } = await svc.versaoVaga(s(), {
          vaga,
          versao: vg0.versao,
          quantidade: 5,
          desde: '2026-12-01',
          motivo: MOTIVO,
        });
        const linhasFaixa = await e.consultar(
          `SELECT ID, CAST(DESDE AS VARCHAR(10)) DESDE, CAST(ATE AS VARCHAR(10)) ATE, ID_ANTERIOR ANT, VALOR FROM SGH_PES_CARGO_FAIXA WHERE ID_CARGO = CAST(CAST(? AS VARCHAR(20)) AS BIGINT) ORDER BY ID`,
          [String(cargo)],
          { teto: 10 },
        );
        const linhasVaga = await e.consultar(
          `SELECT ID, CAST(DESDE AS VARCHAR(10)) DESDE, CAST(ATE AS VARCHAR(10)) ATE, ID_ANTERIOR ANT, QUANTIDADE FROM SGH_PES_VAGA WHERE ID_CARGO = CAST(CAST(? AS VARCHAR(20)) AS BIGINT) ORDER BY ID`,
          [String(cargo)],
          { teto: 10 },
        );
        // 3. Colaborador no cargo: excluir devolve 409 com a contagem e oferece inativar; nada é apagado.
        const v = (
          await servicoPessoas.admitir(s(), {
            cpf: cpfSintetico('900529065'),
            nome: 'CARGO SINTETICO W0-06 COLAB',
            tipo: 'clt',
            admissao: '2026-01-05',
            cargo: 'CARGO SINTETICO W0-06 UTI',
            funcao: null,
            cargaSemanalHoras: 36,
            lotacao: { centroCusto: n(cc?.['COD']), unidade: null, setor: null },
            matricula: 'SINT-W006-C1',
            profissional: null,
            usuario: null,
          })
        ).id;
        // 5d-3a: o cargo do quadro se liga pela ficha do colaborador (motivo, versão, histórico e valor anterior).
        await servicoPessoas.ligarCargo(s(), { vinculo: v, versao: 0, cargo, motivo: MOTIVO });
        const fc1 = await servicoPessoas.ficha(s(), v);
        const [vc] = await e.consultar(
          'SELECT CAST(ID_CARGO AS VARCHAR(20)) C, VERSAO FROM SGH_PES_VINCULO WHERE ID = CAST(CAST(? AS VARCHAR(20)) AS BIGINT)',
          [String(v)],
          { teto: 1 },
        );
        const f1 = await svc.ficha(s(), cargo);
        const recusa = await svc
          .excluir(s(), { alvo: 'cargo', id: cargo, versao: f1.cargo.versao, motivo: MOTIVO })
          .then(
            () => null,
            (x: unknown) =>
              x instanceof ErroProblema
                ? {
                    status: x.getStatus(),
                    codigo: x.extras['codigo'],
                    bloqueios: x.extras.bloqueios ?? [],
                    detalhe: x.detalhe,
                  }
                : { status: 0, codigo: String(x), bloqueios: [], detalhe: '' },
          );
        const [ainda] = await e.consultar(
          'SELECT COUNT(*) N FROM SGH_PES_CARGO WHERE ID = CAST(CAST(? AS VARCHAR(20)) AS BIGINT)',
          [String(cargo)],
          { teto: 1 },
        );
        // A faixa com versão posterior também não se exclui (é histórico).
        const recusaFaixa = await svc
          .excluir(s(), {
            alvo: 'faixa',
            id: faixa,
            versao: (await svc.ficha(s(), cargo)).faixas.find((x) => x.id === faixa)!.versao,
            motivo: MOTIVO,
          })
          .then(
            () => null,
            (x: unknown) => (x instanceof ErroProblema ? x.getStatus() : String(x)),
          );
        // A oferta: inativar com motivo.
        await svc.situacao(s(), {
          alvo: 'cargo',
          id: cargo,
          versao: f1.cargo.versao,
          ativo: false,
          motivo: MOTIVO,
        });
        const f2 = await svc.ficha(s(), cargo);
        // 5d-3a: o cargo inativo não se liga (outro colaborador); o ligado aparece inativo e se retira com motivo.
        const v2 = (
          await servicoPessoas.admitir(s(), {
            cpf: cpfSintetico('900529067'),
            nome: 'CARGO SINTETICO W0-06 COLAB DOIS',
            tipo: 'clt',
            admissao: '2026-01-05',
            cargo: 'CARGO SINTETICO W0-06 UTI',
            funcao: null,
            cargaSemanalHoras: 36,
            lotacao: { centroCusto: n(cc?.['COD']), unidade: null, setor: null },
            matricula: 'SINT-W006-C2',
            profissional: null,
            usuario: null,
          })
        ).id;
        const recusaInativo = await servicoPessoas
          .ligarCargo(s(), { vinculo: v2, versao: 0, cargo, motivo: MOTIVO })
          .then(
            () => null,
            (x: unknown) => (x instanceof ErroProblema ? x.extras['codigo'] : String(x)),
          );
        const fc2 = await servicoPessoas.ficha(s(), v);
        await servicoPessoas.ligarCargo(s(), { vinculo: v, versao: fc2.versao, cargo: null, motivo: MOTIVO });
        const fc3 = await servicoPessoas.ficha(s(), v);
        // O banco recusa o cargo inexistente (FK do 1065).
        const fkVinculo = await s0
          .executar(
            `UPDATE SGH_PES_VINCULO SET ID_CARGO = CAST(CAST(? AS VARCHAR(20)) AS BIGINT) WHERE ID = CAST(CAST(? AS VARCHAR(20)) AS BIGINT)`,
            ['999999999999', String(v2)],
          )
          .then(
            () => 'gravou',
            (x: unknown) =>
              /SGH_FK_PES_VINCULO_CARGO/.test(String((x as Error).message)) ? 'recusou' : String(x),
          );
        // 4. Nunca usado: exclusão física com o retrato antes do DELETE.
        const { id: livre } = await svc.incluirCargo(s(), { ...CARGO, nome: 'CARGO SINTETICO W0-06 LIVRE' });
        const [h0] = await e.consultar('SELECT COALESCE(MAX(ID), 0) M FROM SGH_HIST_EXCLUSAO', [], {
          teto: 1,
        });
        await svc.excluir(s(), {
          alvo: 'cargo',
          id: livre,
          versao: (await svc.ficha(s(), livre)).cargo.versao,
          motivo: MOTIVO,
        });
        const retratos = await e.consultar(
          'SELECT h.TABELA, h.MOTIVO FROM SGH_HIST_EXCLUSAO h WHERE h.ID > ? ORDER BY h.ID',
          [n(h0?.['M'])],
          { teto: 10 },
        );
        const [sobra] = await e.consultar(
          'SELECT COUNT(*) N FROM SGH_PES_CARGO WHERE ID = CAST(CAST(? AS VARCHAR(20)) AS BIGINT)',
          [String(livre)],
          { teto: 1 },
        );
        // 5. O banco também recusa: inativo sem motivo, versão sem motivo, CBO curto e o DELETE do referenciado.
        const banco = async (sql: string, ps: unknown[], re: RegExp) =>
          s0.executar(sql, ps).then(
            () => 'gravou',
            (x: unknown) =>
              re.test(String((x as Error).message)) ? 'recusou' : String((x as Error).message),
          );
        const ckSit = await banco(
          `UPDATE SGH_PES_CARGO SET ATIVO = 'F', MOTIVO_SITUACAO = NULL WHERE ID = CAST(CAST(? AS VARCHAR(20)) AS BIGINT)`,
          [String(cargo)],
          /SGH_CK_PES_CARGO_SIT/,
        );
        const ckCbo = await banco(
          `UPDATE SGH_PES_CARGO SET CBO = '2235' WHERE ID = CAST(CAST(? AS VARCHAR(20)) AS BIGINT)`,
          [String(cargo)],
          /SGH_CK_PES_CARGO_CBO/,
        );
        const ckVersao = await banco(
          `INSERT INTO SGH_PES_CARGO_FAIXA (ID, HOSPITAL, ID_CARGO, FAIXA, NIVEL, VALOR, DESDE, ID_ANTERIOR, CRIADO_POR, ALTERADO_POR)
           VALUES (NEXT VALUE FOR SGH_GEN_PES_CARGO_FAIXA, ?, CAST(CAST(? AS VARCHAR(20)) AS BIGINT), 'B', 'I', 100,
             DATE '2026-01-01', CAST(CAST(? AS VARCHAR(20)) AS BIGINT), 'SGH.TESTE', 'SGH.TESTE')`,
          [a.c.hospital, String(cargo), String(faixa)],
          /SGH_CK_PES_CARGO_FAIXA_VERSAO/,
        );
        const fkCargo = await banco(
          'DELETE FROM SGH_PES_CARGO WHERE ID = CAST(CAST(? AS VARCHAR(20)) AS BIGINT)',
          [String(cargo)],
          /SGH_FK_PES_(VINCULO_CARGO|CARGO_FAIXA_CARGO|VAGA_CARGO)/,
        );
        return {
          cargo,
          faixa,
          faixa2,
          vaga,
          vaga2,
          linhasFaixa,
          linhasVaga,
          f1,
          f2,
          recusa,
          ainda: n(ainda?.['N']),
          recusaFaixa,
          retratos,
          sobra: n(sobra?.['N']),
          ckSit,
          ckCbo,
          ckVersao,
          fkCargo,
          fc1,
          vc,
          recusaInativo,
          fc2,
          fc3,
          fkVinculo,
        };
      });
      // 5d-3a: a ligação pela ficha do colaborador.
      expect(r.fc1.cargoQuadro).toMatchObject({
        id: r.cargo,
        nome: 'CARGO SINTETICO W0-06 UTI',
        ativo: true,
      });
      expect(r.fc1.versao).toBe(1);
      expect([n(r.vc?.['C']), n(r.vc?.['VERSAO'])]).toEqual([r.cargo, 1]);
      expect(r.fc1.historico.find((x) => x.tipo === 'correcao')).toMatchObject({
        registradoPor: 'SGH.RH',
        depois: expect.stringContaining('CARGO SINTETICO W0-06 UTI'),
      });
      expect(r.fc1.correcoes?.[0]).toMatchObject({
        operacao: 'colaborador.cargo_ligado',
        antes: { cargo: null, cargoQuadro: null },
        depois: { cargo: r.cargo },
      });
      expect(r.recusaInativo).toBe('cargo-inativo');
      expect(r.fc2.cargoQuadro).toMatchObject({ id: r.cargo, ativo: false });
      expect(r.fc3.cargoQuadro).toBeNull();
      expect(r.fc3.correcoes?.filter((c) => c.operacao === 'colaborador.cargo_ligado')).toHaveLength(2);
      expect(r.fkVinculo).toBe('recusou');
      expect(r.f1.cargo).toMatchObject({
        nome: 'CARGO SINTETICO W0-06 UTI',
        ativo: true,
        vagasAprovadas: 5,
        ocupadas: 1,
      });
      const alterado = r.f1.correcoes.find((c) => c.operacao === 'cargo.alterado');
      expect(alterado).toMatchObject({ por: 'SGH.RH' });
      expect(JSON.stringify(alterado?.antes)).toContain('"CARGO SINTETICO W0-06"');
      expect(r.f1.correcoes.map((c) => c.operacao)).toEqual(
        expect.arrayContaining(['faixa.versao', 'vaga.versao']),
      );
      expect(
        r.linhasFaixa.map((x) => [
          n(x['ID']),
          x['DESDE'],
          x['ATE'],
          x['ANT'] === null ? null : n(x['ANT']),
          n(x['VALOR']),
        ]),
      ).toEqual([
        [r.faixa, '2026-01-01', '2026-11-30', null, 450_000],
        [r.faixa2, '2026-12-01', null, r.faixa, 480_000],
      ]);
      expect(
        r.linhasVaga.map((x) => [
          n(x['ID']),
          x['ATE'],
          x['ANT'] === null ? null : n(x['ANT']),
          n(x['QUANTIDADE']),
        ]),
      ).toEqual([
        [r.vaga, '2026-11-30', null, 3],
        [r.vaga2, null, r.vaga, 5],
      ]);
      expect(r.recusa).toMatchObject({ status: 409, codigo: expect.stringMatching(/-com-vinculos$/) });
      expect(r.recusa?.bloqueios.length).toBeGreaterThanOrEqual(3);
      expect(r.recusa?.detalhe).toMatch(/inative/);
      expect(r.ainda).toBe(1);
      expect(r.recusaFaixa).toBe(409);
      expect(r.f2.cargo).toMatchObject({
        ativo: false,
        motivoSituacao: 'Lançado com o dado errado na implantação',
      });
      expect(r.f2.correcoes.map((c) => c.operacao)).toEqual(
        expect.arrayContaining(['cargo.alterado', 'cargo.inativado']),
      );
      expect(r.retratos.map((x) => String(x['TABELA']).trim())).toContain('SGH_PES_CARGO');
      expect(r.sobra).toBe(0);
      expect([r.ckSit, r.ckCbo, r.ckVersao, r.fkCargo]).toEqual(['recusou', 'recusou', 'recusou', 'recusou']);
      const final = await a.nucleo.desfazendoNaCopia({ ...a.c, traceId: 'int-w006-4-final' }, (e) =>
        contar(e),
      );
      expect(final).toEqual(antes);
      console.log(
        JSON.stringify({ antes, final, bloqueios: r.recusa?.bloqueios, retratos: r.retratos.length }),
      );
    }, 600_000);

    it('avaliação de desempenho: ciclo, avaliação até a ciência, correção por versão (anterior intacta), alerta de experiência, 409 dos órfãos e PDI com curso concluído', async () => {
      const TABELAS5 = [
        'SGH_PES_COMPETENCIA',
        'SGH_PES_CARGO_COMPETENCIA',
        'SGH_PES_AVAL_CICLO',
        'SGH_PES_AVALIACAO',
        'SGH_PES_AVAL_ITEM',
        'SGH_PES_PDI',
        'SGH_PES_CARGO',
        'SGH_PES_VINCULO',
        'SGH_PES_CURSO',
        'SGH_PES_TREINAMENTO',
        'SGH_PES_TREIN_PARTICIPANTE',
        'SGH_PES_CORRECAO',
        'SGH_HIST_EXCLUSAO',
      ] as const;
      const contar = async (l: {
        consultar: (s: string, p: unknown[], o: { teto: number }) => Promise<Record<string, unknown>[]>;
      }) => {
        const r: Record<string, number> = {};
        for (const t of TABELAS5) {
          const [x] = await l.consultar(`SELECT COUNT(*) N FROM ${t}`, [], { teto: 1 });
          r[t] = n(x?.['N']);
        }
        return r;
      };
      const antes = await a.nucleo.desfazendoNaCopia({ ...a.c, traceId: 'int-w006-5-antes' }, (e) =>
        contar(e),
      );
      const r = await a.nucleo.desfazendoNaCopia({ ...a.c, traceId: 'int-w006-5-crud' }, async (e) => {
        const s0 = somenteSgh(e);
        const [cc] = await e.consultar(
          "SELECT FIRST 1 COD FROM TBCENCUS WHERE COALESCE(SITUACAO, 'A') <> 'I' ORDER BY COD",
          [],
          { teto: 1 },
        );
        const trilha = new RegistradorTrilhaMemoria();
        const config = fonteConfiguracaoMemoria(trilha, {
          chavesIniciais: () => [chave('pessoas.colaborador'), chave('pessoas.treinamento')],
          prerequisitosIniciais: () => [cumprido('pessoas.colaborador'), cumprido('pessoas.treinamento')],
        });
        const pessoas = portaPessoasNaTransacao(e, a.executor);
        const portaCargos = portaCargosNaTransacao(e);
        const cargos = new ServicoCargos(portaCargos, pessoas, trilha, config, null);
        const portaTrein = portaTreinamentoNaTransacao(e);
        const trein = new ServicoTreinamento(portaTrein, pessoas, trilha, config, null);
        const porta = portaAvaliacaoNaTransacao(e);
        const svc = new ServicoAvaliacao(
          porta,
          pessoas,
          portaCargos,
          portaTrein,
          portaPontoNaTransacao(e),
          trilha,
          config,
          null,
        );
        const servicoPessoas = new ServicoPessoas(
          pessoas,
          trilha,
          config,
          null,
          new CifraCpf(Buffer.alloc(32, 67)),
        );
        let k = 0;
        const s = (login = 'SGH.RH'): SessaoCadastro => ({
          req: {
            headers: { 'idempotency-key': `int-w006-5-${Date.now().toString(36)}-${++k}` },
            ip: '127.0.0.1',
            sgh: { sessao: { unidadeAtiva: null } },
          } as never,
          hospital: a.c.hospital,
          rede: a.c.rede,
          login,
          porta: a.c,
          pode: () => true,
        });
        const MOTIVO = 'Lançado com o dado errado na implantação';
        // 0. Cargo, colaborador admitido há 50 dias (o marco de 45 dias já venceu) e no cargo.
        const hoje = await porta.hoje(a.c);
        const d = new Date(`${hoje}T12:00:00Z`);
        d.setUTCDate(d.getUTCDate() - 50);
        const admissao = d.toISOString().slice(0, 10);
        const { id: cargo } = await cargos.incluirCargo(s(), {
          nome: 'CARGO SINTETICO W0-06 AVAL',
          cbo: '322205',
          descricao: null,
          requisitos: null,
          conselho: null,
        });
        const vinculo = (
          await servicoPessoas.admitir(s(), {
            cpf: cpfSintetico('900529066'),
            nome: 'AVALIADA SINTETICA W0-06',
            tipo: 'clt',
            admissao,
            cargo: 'CARGO SINTETICO W0-06 AVAL',
            funcao: null,
            cargaSemanalHoras: 36,
            lotacao: { centroCusto: n(cc?.['COD']), unidade: null, setor: null },
            matricula: 'SINT-W006-A1',
            profissional: null,
            usuario: null,
          })
        ).id;
        await s0.executar(
          `UPDATE SGH_PES_VINCULO SET ID_CARGO = CAST(CAST(? AS VARCHAR(20)) AS BIGINT) WHERE ID = CAST(CAST(? AS VARCHAR(20)) AS BIGINT)`,
          [String(cargo), String(vinculo)],
        );
        // 1. Competências ligadas ao cargo; ciclo periódico (escala 1 a 5) e ciclo de experiência.
        const k1 = (await svc.incluirCompetencia(s(), { nome: 'COMUNICACAO SINT W006', descricao: null })).id;
        const k2 = (await svc.incluirCompetencia(s(), { nome: 'EQUIPE SINT W006', descricao: null })).id;
        for (const competencia of [k1, k2]) await svc.ligarCompetenciaCargo(s(), { cargo, competencia });
        const ciclo = (
          await svc.incluirCiclo(s(), {
            nome: 'CICLO SINT W006',
            tipo: 'periodico',
            inicio: '2026-01-01',
            fim: '2026-12-31',
            prazo: '2027-01-31',
            notaMax: 5,
          })
        ).id;
        const cicloExp = (
          await svc.incluirCiclo(s(), {
            nome: 'EXPERIENCIA SINT W006',
            tipo: 'experiencia',
            inicio: '2026-01-01',
            fim: '2027-12-31',
            prazo: '2027-12-31',
            notaMax: 5,
          })
        ).id;
        const alertaAntes = (await svc.alertasExperiencia(s())).filter((x) => x.vinculo === vinculo);
        // 2. Avaliação: competências do cargo, nota até a escala, finalizada imutável, ciência registrada pelo RH.
        const av1 = (await svc.abrir(s(), { ciclo, vinculo, marco: null, avaliador: null })).id;
        let f = await svc.ficha(s(), av1);
        const notasAbertas = f.notas.map((x) => x.competencia).sort((x, y) => x - y);
        const foraEscala = await erro(
          svc.lancarNotas(s(), {
            avaliacao: av1,
            versao: f.avaliacao.versao,
            parecer: null,
            notas: [{ competencia: k1, nota: 6, comentario: null }],
          }),
        );
        await svc.lancarNotas(s(), {
          avaliacao: av1,
          versao: f.avaliacao.versao,
          parecer: 'Bom desempenho no período.',
          notas: [
            { competencia: k1, nota: 2, comentario: null },
            { competencia: k2, nota: 5, comentario: 'Referência no setor' },
          ],
        });
        f = await svc.ficha(s(), av1);
        await svc.finalizar(s(), { avaliacao: av1, versao: f.avaliacao.versao });
        f = await svc.ficha(s(), av1);
        const finalizadaImutavel = await erro(
          svc.lancarNotas(s(), { avaliacao: av1, versao: f.avaliacao.versao, parecer: null, notas: [] }),
        );
        const outroLogin = await svc
          .cienciaPropria(s('SGH.OUTRO'), { avaliacao: av1, versao: f.avaliacao.versao, observacao: null })
          .then(
            () => 0,
            (x: unknown) => (x instanceof ErroProblema ? x.getStatus() : -1),
          );
        await svc.cienciaRegistrada(s(), {
          avaliacao: av1,
          versao: f.avaliacao.versao,
          observacao: 'Colhida em papel na reunião.',
        });
        const ciente = (await svc.ficha(s(), av1)).avaliacao;
        // 3. Correção: versão nova em rascunho com as notas copiadas; a anterior guardada, intacta e visível.
        const av2 = (await svc.corrigir(s(), { avaliacao: av1, versao: ciente.versao, motivo: MOTIVO })).id;
        const f2 = await svc.ficha(s(), av2);
        const deNovo = await erro(
          svc.corrigir(s(), {
            avaliacao: av1,
            versao: (await svc.ficha(s(), av1)).avaliacao.versao,
            motivo: MOTIVO,
          }),
        );
        await svc.lancarNotas(s(), {
          avaliacao: av2,
          versao: f2.avaliacao.versao,
          parecer: 'Revisada após a ciência.',
          notas: [{ competencia: k1, nota: 3, comentario: null }],
        });
        const notasV1 = await e.consultar(
          'SELECT ID_COMPETENCIA C, NOTA FROM SGH_PES_AVAL_ITEM WHERE ID_AVALIACAO = CAST(CAST(? AS VARCHAR(20)) AS BIGINT) ORDER BY ID_COMPETENCIA',
          [String(av1)],
          { teto: 10 },
        );
        const [linhaV1] = await e.consultar(
          'SELECT SITUACAO, CIENCIA_MODO, NUMERO FROM SGH_PES_AVALIACAO WHERE ID = CAST(CAST(? AS VARCHAR(20)) AS BIGINT)',
          [String(av1)],
          { teto: 1 },
        );
        // 4. Experiência: avaliar o marco de 45 dias tira o alerta; o rascunho se exclui com o retrato das notas.
        const exp = (await svc.abrir(s(), { ciclo: cicloExp, vinculo, marco: 45, avaliador: null })).id;
        const alertaDepois = (await svc.alertasExperiencia(s())).filter((x) => x.vinculo === vinculo);
        const [h0] = await e.consultar('SELECT COALESCE(MAX(ID), 0) M FROM SGH_HIST_EXCLUSAO', [], {
          teto: 1,
        });
        await svc.excluir(s(), {
          avaliacao: exp,
          versao: (await svc.ficha(s(), exp)).avaliacao.versao,
          motivo: MOTIVO,
        });
        const retratos = await e.consultar(
          'SELECT h.TABELA FROM SGH_HIST_EXCLUSAO h WHERE h.ID > ? ORDER BY h.ID',
          [n(h0?.['M'])],
          { teto: 10 },
        );
        const [sobraExp] = await e.consultar(
          'SELECT COUNT(*) N FROM SGH_PES_AVALIACAO WHERE ID = CAST(CAST(? AS VARCHAR(20)) AS BIGINT)',
          [String(exp)],
          { teto: 1 },
        );
        // 5. Órfãos: a competência avaliada e o ciclo com avaliação recusam a exclusão (409 com a contagem).
        const kLida = (await svc.competencias(s())).competencias.find((x) => x.id === k1)!;
        const orfaoComp = await erro(
          svc.excluirCompetencia(s(), { competencia: k1, versao: kLida.versao, motivo: MOTIVO }),
        );
        const cLido = (await svc.ciclos(s())).find((x) => x.id === ciclo)!;
        const orfaoCiclo = await erro(svc.excluirCiclo(s(), { ciclo, versao: cLido.versao, motivo: MOTIVO }));
        // 6. PDI ligado à competência e ao curso concluído (turma com aproveitamento aprovado).
        const linhaTrilha = {
          rede: a.c.rede,
          hospital: a.c.hospital,
          usuario: 'SGH.TESTE',
          evento: 'pessoas.turma.incluida',
          recurso: 'pessoas.treinamento',
          operacao: 'pessoas.turma.incluida',
          tabelaAlvo: 'SGH_PES_TREINAMENTO',
          idAlvo: null,
          chaveNaturalAlvo: null,
          resultado: 'sucesso',
          estacao: null,
          correlacao: 'int-w006-5',
        };
        const { curso, turma } = await portaTrein.gravarSgh(a.c, linhaTrilha, async (g) => {
          const curso = await g.incluirCurso({
            codigo: 'SINTW0065',
            titulo: 'Curso sintético W0-06 PDI',
            conteudo: 'Conteúdo sintético',
            categoria: 'nr32',
            cargaMinimaMin: 60,
            validadeMeses: 12,
            obrigatorio: false,
            alvos: [],
            por: 'SGH.TESTE',
          });
          const turma = await g.incluirTurma({
            curso,
            inicio: '2026-02-10',
            fim: '2026-02-11',
            cargaMin: 120,
            instrutor: 'INSTRUTORA SINTETICA',
            modalidade: 'presencial',
            local: 'Auditório',
            pop: null,
            observacao: null,
            por: 'SGH.TESTE',
          });
          await g.incluirParticipante({ treinamento: turma, vinculo, por: 'SGH.TESTE' });
          return { curso, turma };
        });
        await trein.registrarParticipacao(s(), {
          treinamento: turma,
          vinculo,
          presenca: 'presente',
          aproveitamento: 'aprovado',
          conclusao: '2026-02-11',
          observacao: null,
          versao: (await trein.turma(s(), turma)).lista.find((x) => x.vinculo === vinculo)!.versao,
        });
        const pdi = (
          await svc.incluirPdi(s(), {
            vinculo,
            avaliacao: av1,
            competencia: k1,
            curso,
            acao: 'Fazer o curso de comunicação',
            prazo: '2026-12-31',
          })
        ).id;
        await svc.alterarPdi(s(), {
          pdi,
          versao: 0,
          avaliacao: av1,
          competencia: k1,
          curso,
          acao: 'Fazer o curso de comunicação',
          prazo: '2027-01-31',
          motivo: MOTIVO,
        });
        await svc.situacaoPdi(s(), {
          pdi,
          versao: 1,
          situacao: 'concluida',
          concluidaEm: '2026-02-11',
          motivo: MOTIVO,
        });
        const doColab = await svc.doColaborador(s(), vinculo);
        // 7. O banco também recusa: escala fora de 2..10, correção sem motivo, PDI cancelado sem motivo, FK.
        const banco = async (sql: string, ps: unknown[], re: RegExp) =>
          s0.executar(sql, ps).then(
            () => 'gravou',
            (x: unknown) =>
              re.test(String((x as Error).message)) ? 'recusou' : String((x as Error).message),
          );
        const ckNota = await banco(
          'UPDATE SGH_PES_AVAL_CICLO SET NOTA_MAX = 11 WHERE ID = CAST(CAST(? AS VARCHAR(20)) AS BIGINT)',
          [String(ciclo)],
          /SGH_CK_PES_AVAL_CICLO_NOTA/,
        );
        const ckCorrecao = await banco(
          'UPDATE SGH_PES_AVALIACAO SET MOTIVO_CORRECAO = NULL WHERE ID = CAST(CAST(? AS VARCHAR(20)) AS BIGINT)',
          [String(av2)],
          /SGH_CK_PES_AVALIACAO_CORRECAO/,
        );
        const ckPdi = await banco(
          `UPDATE SGH_PES_PDI SET SITUACAO = 'cancelada', CONCLUIDA_EM = NULL, MOTIVO_SITUACAO = NULL WHERE ID = CAST(CAST(? AS VARCHAR(20)) AS BIGINT)`,
          [String(pdi)],
          /SGH_CK_PES_PDI_SIT/,
        );
        const fkComp = await banco(
          'DELETE FROM SGH_PES_COMPETENCIA WHERE ID = CAST(CAST(? AS VARCHAR(20)) AS BIGINT)',
          [String(k1)],
          /SGH_FK_PES_(CARGO_COMP_COMP|AVAL_ITEM_COMP|PDI_COMP)/,
        );
        return {
          av1,
          av2,
          k1,
          k2,
          alertaAntes,
          alertaDepois,
          notasAbertas,
          foraEscala,
          finalizadaImutavel,
          outroLogin,
          ciente,
          f2,
          deNovo,
          notasV1: notasV1.map((x) => [n(x['C']), n(x['NOTA'])]),
          linhaV1: {
            situacao: String(linhaV1?.['SITUACAO']).trim(),
            modo: String(linhaV1?.['CIENCIA_MODO']).trim(),
            numero: n(linhaV1?.['NUMERO']),
          },
          retratos: retratos.map((x) => String(x['TABELA']).trim()),
          sobraExp: n(sobraExp?.['N']),
          orfaoComp,
          orfaoCiclo,
          pdi: doColab.pdi.find((x) => x.id === pdi),
          correcoesPdi: doColab.correcoes.map((c) => c.operacao),
          ckNota,
          ckCorrecao,
          ckPdi,
          fkComp,
        };
      });
      expect(r.alertaAntes).toEqual([expect.objectContaining({ marco: 45, situacao: 'vencido' })]);
      expect(r.alertaDepois).toEqual([]);
      expect(r.notasAbertas).toEqual([r.k1, r.k2].sort((x, y) => x - y));
      expect(r.foraEscala.codigo).toBe('nota-fora-da-escala');
      expect(r.finalizadaImutavel.codigo).toBe('avaliacao-finalizada');
      expect(r.outroLogin).toBe(404);
      expect(r.ciente).toMatchObject({ situacao: 'ciente', cienciaModo: 'registrada', cienciaPor: 'SGH.RH' });
      expect(r.f2.avaliacao).toMatchObject({
        numero: 2,
        anterior: r.av1,
        motivoCorrecao: 'Lançado com o dado errado na implantação',
        situacao: 'rascunho',
      });
      expect(r.f2.versoes.map((x) => x.avaliacao.numero)).toEqual([2, 1]);
      expect(r.f2.versoes[1]?.avaliacao).toMatchObject({ situacao: 'ciente', substituida: true });
      expect(r.deNovo.codigo).toBe('avaliacao-substituida');
      expect(r.notasV1).toEqual(
        [
          [r.k1, 2],
          [r.k2, 5],
        ].sort((x, y) => x[0]! - y[0]!),
      );
      expect(r.linhaV1).toEqual({ situacao: 'ciente', modo: 'registrada', numero: 1 });
      expect(r.retratos).toEqual(expect.arrayContaining(['SGH_PES_AVAL_ITEM', 'SGH_PES_AVALIACAO']));
      expect(r.sobraExp).toBe(0);
      expect(r.orfaoComp.codigo).toBe('competencia-com-vinculos');
      expect(r.orfaoComp.bloqueios.length).toBeGreaterThanOrEqual(2);
      expect(r.orfaoCiclo.codigo).toBe('ciclo-avaliacao-com-vinculos');
      expect(r.orfaoCiclo.bloqueios).toEqual(['Avaliações do ciclo: 2']);
      expect(r.pdi).toMatchObject({
        cursoTitulo: 'Curso sintético W0-06 PDI',
        cursoConcluidoEm: '2026-02-11',
        prazo: '2027-01-31',
        situacao: 'concluida',
        concluidaEm: '2026-02-11',
      });
      expect(r.correcoesPdi.length).toBeGreaterThanOrEqual(2);
      expect([r.ckNota, r.ckCorrecao, r.ckPdi, r.fkComp]).toEqual([
        'recusou',
        'recusou',
        'recusou',
        'recusou',
      ]);
      const final = await a.nucleo.desfazendoNaCopia({ ...a.c, traceId: 'int-w006-5-final' }, (e) =>
        contar(e),
      );
      expect(final).toEqual(antes);
      console.log(JSON.stringify({ antes, final, bloqueios: r.orfaoComp.bloqueios }));
    }, 600_000);
  },
);
