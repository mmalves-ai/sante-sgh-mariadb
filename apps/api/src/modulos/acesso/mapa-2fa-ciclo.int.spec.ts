// W0-09 na cópia (transação desfeita; script 1126), parte 4b: voltar a decisão do mapa a 'proposta' exige o motivo
// (recusado antes de gravar) e deixa o anterior, quem aprovara e quantos perdiam em SGH_ACESSO_MAPA_DECISAO (só
// inclusão), com a SGH_TRILHA na mesma transação; os candidatos da prévia são os usuários ativos do grupo. Alterar
// o prazo e o alvo da política do segundo fator encerra a vigente como "Alterada" e inclui a nova com a mesma onda e
// o mesmo início. Só contagens na saída (nenhum login nem nome impresso).
import { resolve } from 'node:path';
import {
  alterarPolitica2fa,
  ambienteEfetivo,
  caminhoArquivoAmbiente,
  decidirMapaOpcao,
  ErroMotivoMapa,
  exigirTravaDaCopia,
  incluirPolitica2fa,
  lerCandidatosMapa,
  lerConfiguracaoNucleo,
  lerDecisoesMapa,
  lerPoliticas2fa,
  NucleoLegado,
} from '@sgh/legado';
import { criarDriverNativo } from '@sgh/legado/nativo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const raiz = resolve(import.meta.dirname, '../../../../..');
const { env: base } = ambienteEfetivo(caminhoArquivoAmbiente(process.env, raiz));
const env: Record<string, string> = {
  ...(base as Record<string, string>),
  AMBIENTE: 'dev',
  FB_POOL_TETO: '2',
};

let nucleo: NucleoLegado;
let hospital = '';

beforeAll(async () => {
  exigirTravaDaCopia();
  nucleo = new NucleoLegado({
    env,
    driver: criarDriverNativo({ biblioteca: lerConfiguracaoNucleo(env).bibliotecaCliente }),
    pastaHomologada: resolve(raiz, 'tools/schema-check/homologado'),
  });
  const saude = await nucleo.partida();
  hospital = saude.find((s) => s.disponivel)?.codigo ?? '';
  if (!hospital) throw new Error('Nenhum estabelecimento da cópia disponível.');
});
afterAll(async () => {
  await nucleo?.encerrar();
});

const ctx = () => ({ rede: nucleo.rede, hospital, traceId: 'integracao-w009-4b' });
const trilha = (evento: string, operacao: string) => ({
  rede: nucleo.rede,
  hospital,
  usuario: 'SGH.TESTE',
  evento,
  recurso: 'teste.w009',
  operacao,
  chaveNaturalAlvo: null,
  resultado: 'sucesso',
  estacao: 'integracao',
  correlacao: 'integracao-w009-4b',
});

describe('W0-09 parte 4b na cópia (desfeito no fim)', () => {
  it('mapa: voltar a proposta exige motivo; histórico com o anterior; candidatos do grupo; trilha junta', async () => {
    const r = await nucleo.desfazendoNaCopia(ctx(), async (e) => {
      const conta = async (sql: string, p: unknown[] = []) =>
        Number((await e.consultar(sql, p, { teto: 1 }))[0]?.['N'] ?? 0);
      const [g] = await e.consultar(
        `SELECT FIRST 1 GRUPO, COUNT(*) N FROM TBUSERS WHERE STATUS = 'T' AND GRUPO IS NOT NULL AND GRUPO <> ''
          GROUP BY GRUPO ORDER BY 2 DESC`,
        [],
        { teto: 1 },
      );
      const grupo = String(g?.['GRUPO'] ?? '').trimEnd();
      const ativosDoGrupo = Number(g?.['N'] ?? 0);
      const trilhaAntes = await conta(`SELECT COUNT(*) N FROM SGH_TRILHA WHERE CORRELACAO = ?`, [
        'integracao-w009-4b',
      ]);
      const d = {
        tipo: 'grupo-perfil' as const,
        grupo,
        perfil: 'auditor',
        permissao: null,
        origem: 'revisao-area' as const,
        por: 'SGH.TESTE',
      };
      const t = trilha('acesso.mapa.decidido', 'acesso.decidirMapa');
      const ap = await decidirMapaOpcao(e, { ...d, situacao: 'aprovada' }, t);
      let semMotivo = false;
      try {
        await decidirMapaOpcao(e, { ...d, situacao: 'proposta', motivo: 'abc' }, t);
      } catch (x) {
        semMotivo = x instanceof ErroMotivoMapa;
      }
      const cand = await lerCandidatosMapa(e, { tipo: 'grupo-perfil', grupo, perfil: 'auditor' });
      const volta = await decidirMapaOpcao(
        e,
        {
          ...d,
          situacao: 'proposta',
          motivo: 'revisão da área (teste)',
          usuariosAfetados: cand.logins.length,
        },
        t,
      );
      const [linha] = await e.consultar(
        `SELECT SITUACAO, APROVADO_POR FROM SGH_ACESSO_MAPA_OPCAO WHERE ID = CAST(CAST(? AS VARCHAR(20)) AS BIGINT)`,
        [ap.id],
        { teto: 1 },
      );
      const decisoes = await lerDecisoesMapa(e, ap.id);
      // Perfil → permissão: os candidatos por grupo do mapa, concessão e papel SBIS (só confere que a consulta roda).
      const porPerfil = await lerCandidatosMapa(e, {
        tipo: 'perfil-permissao',
        grupo: null,
        perfil: 'auditor',
        papeis: [2],
      });
      return {
        ativosDoGrupo,
        candidatos: cand.logins.length,
        limitado: cand.limitado,
        semMotivo,
        apAntes: ap.situacaoAntes,
        voltaAntes: volta.situacaoAntes,
        mesmaLinha: volta.id === ap.id,
        situacao: String(linha?.['SITUACAO'] ?? '').trimEnd(),
        aprovadoPor: linha?.['APROVADO_POR'] ?? null,
        decisoes: decisoes.map((x) => ({
          antes: x.situacaoAntes,
          aprovadoPorAntes: x.aprovadoPorAntes,
          situacao: x.situacao,
          motivo: x.motivo,
          afetados: x.usuariosAfetados,
          por: x.decididoPor,
        })),
        porPerfilRodou: Array.isArray(porPerfil.logins),
        trilha:
          (await conta(`SELECT COUNT(*) N FROM SGH_TRILHA WHERE CORRELACAO = ?`, ['integracao-w009-4b'])) -
          trilhaAntes,
      };
    });
    expect(r.ativosDoGrupo).toBeGreaterThan(0);
    expect(r.candidatos).toBe(Math.min(r.ativosDoGrupo, 5000));
    expect(r.semMotivo).toBe(true);
    expect(r.apAntes).toBeNull();
    expect(r.voltaAntes).toBe('aprovada');
    expect(r.mesmaLinha).toBe(true);
    expect(r.situacao).toBe('proposta');
    expect(r.aprovadoPor).toBeNull();
    expect(r.decisoes).toEqual([
      {
        antes: 'aprovada',
        aprovadoPorAntes: 'SGH.TESTE',
        situacao: 'proposta',
        motivo: 'revisão da área (teste)',
        afetados: r.candidatos,
        por: 'SGH.TESTE',
      },
      {
        antes: null,
        aprovadoPorAntes: null,
        situacao: 'aprovada',
        motivo: null,
        afetados: null,
        por: 'SGH.TESTE',
      },
    ]);
    expect(r.porPerfilRodou).toBe(true);
    expect(r.trilha).toBe(2);
  });

  it('2FA: alterar prazo e alvo encerra a vigente como "Alterada" e inclui a nova (mesma onda e início)', async () => {
    const r = await nucleo.desfazendoNaCopia(ctx(), async (e) => {
      const t = trilha('acesso.politicaSegundoFator.alterada', 'alterar');
      const { id } = await incluirPolitica2fa(
        e,
        {
          hospital,
          alvo: 'perfil',
          valor: 'auditor',
          onda: 1,
          inicio: '2099-01-10',
          prazoAdesaoDias: 7,
          motivo: 'linha de teste W0-09',
          criadaPor: 'SGH.TESTE',
        },
        t,
      );
      const alt = await alterarPolitica2fa(
        e,
        {
          id,
          hospital,
          por: 'SGH.TESTE',
          alvo: 'grupo',
          valor: 'W009TESTE',
          prazoAdesaoDias: 30,
          motivo: 'prazo maior (teste)',
        },
        t,
      );
      const de = await alterarPolitica2fa(
        e,
        {
          id,
          hospital,
          por: 'SGH.TESTE',
          alvo: 'perfil',
          valor: 'auditor',
          prazoAdesaoDias: 3,
          motivo: 'de novo',
        },
        t,
      );
      const linhas = (await lerPoliticas2fa(e, hospital)).filter((l) => l.id === id || l.id === alt?.id);
      const [enc] = await e.consultar(
        `SELECT MOTIVO_ENCERRAMENTO, ENCERRADA_POR FROM SGH_ACESSO_POLITICA_2FA
          WHERE ID = CAST(CAST(? AS VARCHAR(20)) AS BIGINT)`,
        [id],
        { teto: 1 },
      );
      return {
        anterior: alt?.anterior === id,
        repetida: de,
        motivoEncerramento: String(enc?.['MOTIVO_ENCERRAMENTO'] ?? '').trimEnd(),
        encerradaPor: String(enc?.['ENCERRADA_POR'] ?? '').trimEnd(),
        linhas: linhas
          .map((l) => ({
            nova: l.id !== id,
            alvo: l.alvo,
            valor: l.valor,
            onda: l.onda,
            inicio: l.inicio,
            prazo: l.prazoAdesaoDias,
            ativa: l.encerradaEm === null,
          }))
          .sort((a, b) => Number(a.nova) - Number(b.nova)),
      };
    });
    expect(r.anterior).toBe(true);
    expect(r.repetida).toBeNull();
    expect(r.motivoEncerramento).toBe('Alterada: prazo maior (teste)');
    expect(r.encerradaPor).toBe('SGH.TESTE');
    expect(r.linhas).toEqual([
      {
        nova: false,
        alvo: 'perfil',
        valor: 'auditor',
        onda: 1,
        inicio: '2099-01-10',
        prazo: 7,
        ativa: false,
      },
      {
        nova: true,
        alvo: 'grupo',
        valor: 'W009TESTE',
        onda: 1,
        inicio: '2099-01-10',
        prazo: 30,
        ativa: true,
      },
    ]);
  });
});
