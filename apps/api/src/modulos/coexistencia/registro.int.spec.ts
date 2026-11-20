// W0-09 na cópia (transação desfeita; script 1123; D-RETRO-REGISTRO-F6): o registro do fim e o da retrocompatibilidade
// gravados pela tela em SGH_CFG_COEX_REGISTRO. Cada gravação é versão nova (só inclusão, PK por versão) com a linha
// da SGH_TRILHA na mesma transação; o JSON com acento volta igual (ASCII \uXXXX na coluna); a versão nula volta ao
// arquivo; o papel da aplicação não altera nem apaga versão. Só contagens e códigos na saída.
import { resolve } from 'node:path';
import {
  ambienteEfetivo,
  caminhoArquivoAmbiente,
  exigirTravaDaCopia,
  lerConfiguracaoNucleo,
  NucleoLegado,
} from '@sgh/legado';
import { criarDriverNativo } from '@sgh/legado/nativo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SessaoCadastro } from '../cadastro/comum.js';
import { ServicoRegistroCoex } from './aplicacao/registro.js';
import { portaCoexistenciaNaTransacao } from './porta-legado.js';

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

const sessao = (): SessaoCadastro =>
  ({
    req: { headers: {}, ip: '127.0.0.1' },
    porta: { rede: nucleo.rede, hospital },
    rede: nucleo.rede,
    hospital,
    login: 'SGH.TESTE',
    pode: () => true,
  }) as unknown as SessaoCadastro;
const ctx = () => ({ rede: nucleo.rede, hospital, traceId: 'integracao-w009-registro' });
const MOTIVO = 'Decisão registrada na reunião do comitê';

describe('W0-09: registro do fim e da retrocompatibilidade na cópia (desfeito no fim)', () => {
  it('versões só por inclusão com a trilha; acento preservado; null volta ao arquivo', async () => {
    const r = await nucleo.desfazendoNaCopia(ctx(), async (e) => {
      const porta = portaCoexistenciaNaTransacao(e);
      const s = new ServicoRegistroCoex(porta, () => Promise.resolve('tela'));
      const conta = async (sql: string, p: unknown[] = []) =>
        Number((await e.consultar(sql, p, { teto: 1 }))[0]?.['N'] ?? 0);
      const trilhaAntes = await conta(
        `SELECT COUNT(*) N FROM SGH_TRILHA WHERE EVENTO = 'coexistencia.registro.gravado' AND HOSPITAL = ?`,
        [hospital],
      );
      const base = (await s.ler(sessao(), 'retrocompatibilidade')).historico.length;
      const conteudo = {
        formato: 1,
        estabelecimento: hospital,
        decisao: { situacao: 'mantida', data: '2026-11-18', referencia: 'ata de decisão – revisão' },
        passos: {},
      };
      const g1 = await s.gravar(sessao(), 'retrocompatibilidade', { conteudo, motivo: MOTIVO, senha: 'x' });
      const vigente = await s.vigente({ rede: nucleo.rede, hospital }, 'retrocompatibilidade');
      const g2 = await s.gravar(sessao(), 'retrocompatibilidade', {
        conteudo: null,
        motivo: MOTIVO,
        senha: 'x',
      });
      const trilhaDepois = await conta(
        `SELECT COUNT(*) N FROM SGH_TRILHA WHERE EVENTO = 'coexistencia.registro.gravado' AND HOSPITAL = ?`,
        [hospital],
      );
      const ascii = await conta(
        `SELECT COUNT(*) N FROM SGH_CFG_COEX_REGISTRO WHERE HOSPITAL = ? AND TIPO = 'retrocompatibilidade'
          AND CONTEUDO CONTAINING '\\u00e3'`,
        [hospital],
      );
      return {
        base,
        g1: { fonte: g1.fonte, versao: g1.versaoVigente, n: g1.historico.length },
        referencia: (vigente?.['decisao'] as { referencia?: string } | undefined)?.referencia,
        g2: { fonte: g2.fonte, versao: g2.versaoVigente, retorno: g2.historico[0]?.retornoAoArquivo },
        trilha: trilhaDepois - trilhaAntes,
        ascii,
      };
    });
    expect(r.g1).toEqual({ fonte: 'tela', versao: r.base + 1, n: r.base + 1 });
    expect(r.referencia).toBe('ata de decisão – revisão');
    expect(r.g2).toEqual({ fonte: 'arquivo', versao: null, retorno: true });
    expect(r.trilha).toBe(2);
    expect(r.ascii).toBeGreaterThanOrEqual(1);
  });

  it('o papel da aplicação não altera nem apaga versão (só SELECT e INSERT)', async () => {
    const privs = await nucleo.lerSomente(ctx(), (l) =>
      l.consultar(
        `SELECT DISTINCT TRIM(RDB$PRIVILEGE) P FROM RDB$USER_PRIVILEGES
          WHERE RDB$RELATION_NAME = 'SGH_CFG_COEX_REGISTRO' AND RDB$USER = 'SGH_APLICACAO'`,
        [],
        { teto: 10 },
      ),
    );
    expect(privs.map((x) => String(x['P']).trim()).sort()).toEqual(['I', 'S']);
  });
});
