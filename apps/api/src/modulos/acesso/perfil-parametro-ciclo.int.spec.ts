// W0-09 na cópia (transação desfeita; scripts 1124 e 1125), parte 4a: retirar a sobreposição de parâmetro fecha a
// versão vigente com quem e o motivo (nada se apaga; outra definição no meio: conflito) e alterar a vigência e o
// motivo do perfil concedido deixa o anterior em SGH_ACESSO_PERFIL_ALTERACAO (só inclusão), as duas com a linha da
// SGH_TRILHA na mesma transação. Login e usuário sintéticos (sem FK para o legado); só contagens na saída.
import { resolve } from 'node:path';
import {
  alterarConcessaoPerfil,
  ambienteEfetivo,
  caminhoArquivoAmbiente,
  exigirTravaDaCopia,
  gravarConcessaoPerfil,
  gravarDefinicaoParametro,
  lerAlteracoesPerfil,
  lerConfiguracaoNucleo,
  lerHistoricoPerfis,
  lerValoresParametro,
  NucleoLegado,
  retirarSobreposicaoParametro,
  revogarConcessaoPerfil,
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

const ctx = () => ({ rede: nucleo.rede, hospital, traceId: 'integracao-w009-4a' });
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
  correlacao: 'integracao-w009-4a',
});

describe('W0-09 parte 4a na cópia (desfeito no fim)', () => {
  it('retirar a sobreposição: versão fechada com quem e o motivo, sem apagar; conflito com outra vigente', async () => {
    const r = await nucleo.desfazendoNaCopia(ctx(), async (e) => {
      const conta = async (sql: string, p: unknown[] = []) =>
        Number((await e.consultar(sql, p, { teto: 1 }))[0]?.['N'] ?? 0);
      const chave = 'cadastro.itensPorPagina';
      const alvo = 'W009T';
      const linhasAntes = await conta(`SELECT COUNT(*) N FROM SGH_CFG_PARAMETRO WHERE HOSPITAL = ?`, [
        hospital,
      ]);
      const def = await gravarDefinicaoParametro(
        e,
        {
          rede: nucleo.rede,
          hospital,
          fechar: [],
          nova: {
            chave,
            nivel: 'perfil',
            alvo,
            valor: '40',
            vigenteDesde: new Date().toISOString(),
            vigenteAte: null,
            justificativa: 'definição de teste W0-09',
            autor: 'SGH.TESTE',
          },
          perfil: alvo,
        },
        { ...trilha('config.parametro.definido', 'config.definirParametro'), chaveNaturalAlvo: null },
      );
      let conflito = '';
      await retirarSobreposicaoParametro(
        e,
        {
          rede: nucleo.rede,
          hospital,
          chave,
          nivel: 'perfil',
          alvo,
          fechar: ['1'],
          motivo: 'x',
          por: 'SGH.TESTE',
        },
        trilha('config.parametro.retirado', 'config.retirarParametro'),
      ).catch((x: unknown) => (conflito = (x as { codigo?: string }).codigo ?? 'outro'));
      const trilhaAntes = await conta(
        `SELECT COUNT(*) N FROM SGH_TRILHA WHERE EVENTO = 'config.parametro.retirado' AND HOSPITAL = ?`,
        [hospital],
      );
      const ret = await retirarSobreposicaoParametro(
        e,
        {
          rede: nucleo.rede,
          hospital,
          chave,
          nivel: 'perfil',
          alvo,
          fechar: [def.id],
          motivo: 'volta a herdar do estabelecimento',
          por: 'SGH.TESTE',
        },
        trilha('config.parametro.retirado', 'config.retirarParametro'),
      );
      const versao = (await lerValoresParametro(e, hospital, chave)).find((v) => v.id === def.id);
      return {
        conflito,
        fechadas: ret.fechadas,
        id: def.id,
        versao,
        vigentesNoAlvo: await conta(
          `SELECT COUNT(*) N FROM SGH_CFG_PARAMETRO WHERE HOSPITAL = ? AND CHAVE = ? AND ALVO = ? AND VIGENTE_ATE IS NULL`,
          [hospital, chave, alvo],
        ),
        linhas:
          (await conta(`SELECT COUNT(*) N FROM SGH_CFG_PARAMETRO WHERE HOSPITAL = ?`, [hospital])) -
          linhasAntes,
        trilha:
          (await conta(
            `SELECT COUNT(*) N FROM SGH_TRILHA WHERE EVENTO = 'config.parametro.retirado' AND HOSPITAL = ?`,
            [hospital],
          )) - trilhaAntes,
      };
    });
    expect(r.conflito).toBe('conflito-concorrente');
    expect(r.fechadas).toEqual([r.id]);
    expect(r.versao).toMatchObject({
      valor: '40',
      retiradaPor: 'SGH.TESTE',
      retiradaMotivo: 'volta a herdar do estabelecimento',
    });
    expect(r.versao?.vigenteAte).not.toBeNull();
    expect(r.vigentesNoAlvo).toBe(0);
    expect(r.linhas).toBe(1);
    expect(r.trilha).toBe(1);
  });

  it('alterar o perfil concedido: anterior na alteração (só inclusão), trilha junta; a si mesmo e revogada recusadas', async () => {
    const r = await nucleo.desfazendoNaCopia(ctx(), async (e) => {
      const conta = async (sql: string, p: unknown[] = []) =>
        Number((await e.consultar(sql, p, { teto: 1 }))[0]?.['N'] ?? 0);
      const inicio = new Date(Date.now() - 3_600_000);
      const fim = new Date(Date.now() + 86_400_000);
      const { id } = await gravarConcessaoPerfil(
        e,
        {
          idUsuario: 32000,
          login: 'SGH.W009.ALVO',
          perfil: 'auditor',
          concedidoPor: 'SGH.TESTE',
          areaAprovou: 'gestor-acessos',
          inicio,
          fim,
          motivo: 'chamado de teste',
        },
        trilha('acesso.perfil.concedido', 'acesso.concederPerfil'),
      );
      const trilhaAntes = await conta(
        `SELECT COUNT(*) N FROM SGH_TRILHA WHERE EVENTO = 'acesso.perfil.alterado' AND HOSPITAL = ?`,
        [hospital],
      );
      const novoFim = new Date(Date.now() + 7 * 86_400_000);
      const ok = await alterarConcessaoPerfil(
        e,
        {
          id,
          inicio,
          fim: novoFim,
          motivo: 'cobertura estendida',
          justificativa: 'férias prorrogadas',
          por: 'SGH.TESTE',
        },
        trilha('acesso.perfil.alterado', 'acesso.alterarPerfil'),
      );
      const aSi = await alterarConcessaoPerfil(
        e,
        { id, inicio, fim: null, motivo: 'x', justificativa: 'a si mesmo', por: 'SGH.W009.ALVO' },
        trilha('acesso.perfil.alterado', 'acesso.alterarPerfil'),
      );
      const inexistente = await alterarConcessaoPerfil(
        e,
        { id: '999999999', inicio, fim: null, motivo: 'x', justificativa: 'inexistente', por: 'SGH.TESTE' },
        trilha('acesso.perfil.alterado', 'acesso.alterarPerfil'),
      );
      const [hist] = await lerHistoricoPerfis(e, 'SGH.W009.ALVO');
      const alts = await lerAlteracoesPerfil(e, id);
      // Revogar com motivo (parte 9b3): a concessão fica, com quem revogou e por quê.
      const revogou = await revogarConcessaoPerfil(
        e,
        id,
        'SGH.TESTE',
        trilha('acesso.perfil.revogado', 'acesso.revogarPerfil'),
        'saiu da equipe de auditoria',
      );
      const [revogada] = await lerHistoricoPerfis(e, 'SGH.W009.ALVO');
      return {
        revogou,
        revogada,
        ok,
        aSi,
        inexistente,
        hist,
        alts,
        fim: fim.getTime(),
        novoFim: novoFim.getTime(),
        trilha:
          (await conta(
            `SELECT COUNT(*) N FROM SGH_TRILHA WHERE EVENTO = 'acesso.perfil.alterado' AND HOSPITAL = ?`,
            [hospital],
          )) - trilhaAntes,
      };
    });
    expect(r.ok).toMatchObject({ situacao: 'ok', login: 'SGH.W009.ALVO', perfil: 'auditor' });
    expect(r.aSi).toEqual({ situacao: 'a-si-mesmo' });
    expect(r.inexistente).toEqual({ situacao: 'inexistente' });
    expect(r.hist).toMatchObject({ motivo: 'cobertura estendida', alteracoes: 1 });
    // A hora civil do banco tem precisão de 0,1 ms; a comparação é ao segundo.
    expect(Math.round((r.hist?.fim?.getTime() ?? 0) / 1000)).toBe(Math.round(r.novoFim / 1000));
    expect(r.alts).toHaveLength(1);
    expect(r.alts[0]).toMatchObject({
      motivoAntes: 'chamado de teste',
      motivo: 'cobertura estendida',
      justificativa: 'férias prorrogadas',
      alteradoPor: 'SGH.TESTE',
    });
    expect(Math.round((r.alts[0]?.fimAntes?.getTime() ?? 0) / 1000)).toBe(Math.round(r.fim / 1000));
    expect(r.trilha).toBe(1);
    expect(r.revogou).toEqual({ login: 'SGH.W009.ALVO', perfil: 'auditor' });
    expect(r.revogada).toMatchObject({
      id: r.hist?.id,
      revogadoPor: 'SGH.TESTE',
      revogadoMotivo: 'saiu da equipe de auditoria',
    });
    expect(r.revogada?.revogadoEm).toBeInstanceOf(Date);
  });
});
