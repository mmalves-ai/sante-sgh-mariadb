// Integração do PIN da troca rápida (F2.2, lote 03-02): a mesma bateria na memória e na porta própria contra o MariaDB
// real, no cliente de teste da onda 3 (f22_o3, banco cliente_f22_o3). A tabela pin_troca_rapida é pedido do lote
// (docs/obra/fatias/f22/saida/03-02-pin.sql): enquanto o integrador não a aplica nas migrações, o teste a cria no cliente
// de teste (COMMENT marcado "[teste 03-02]") e a apaga no fim. Massa SINTÉTICA (marca F22L0302P); resumos fictícios.
// Contrato de efeito no banco: uma linha viva, o resumo apagado ao encerrar, a versão, a trilha e as recusas.
// SGH_NUCLEO_SEM_BANCO=1 pula o arquivo.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ErroOperacao, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type PortaPin, portaPinMemoria, type TrilhaPin } from './porta-pin.js';
import { PortaPinPropria } from './porta-pin-propria.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o3';
const BANCO = `cliente_${CLIENTE}`;
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const RAIZ = resolve(import.meta.dirname, '../../../..');
const MARCA = '[teste 03-02]';
const HOSPITAL = 'f22l0302p';
const LOGIN = 'f22.l0302.pin';
const ADMIN = 'f22.l0302.admin';
const RESUMO = (k: number) =>
  `$argon2id$v=19$m=65536,t=3,p=4$c2FsdHNpbnRldGljbw$${String(k).padStart(43, 'A')}`;

const sql = (entrada: string, ...args: string[]) =>
  execFileSync(resolve(RAIZ, 'tools/db/sql.sh'), [BANCO, ...args], { input: entrada, encoding: 'utf8' });

async function codigoDaRecusa(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (e) {
    return e instanceof ErroOperacao ? String(e.problema['codigo'] ?? '') : String(e);
  }
}

describe.skipIf(SEM_BANCO)('PIN da troca rápida: memória e banco (cliente f22_o3)', () => {
  let nucleo: NucleoProprio;
  let criadaPeloTeste = false;
  const ids = { est: 0, usuario: 0, admin: 0 };
  let seq = 0;
  const trilha = (evento: string): TrilhaPin => ({
    rede: 'f22',
    hospital: HOSPITAL,
    usuario: ADMIN,
    evento,
    recurso: 'acesso.trocaRapida',
    operacao: evento,
    resultado: 'sucesso',
    estacao: null,
    correlacao: `f22-0302-pin-${++seq}`,
  });

  async function limpar(): Promise<void> {
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'f22-0302-pin-limpeza' }, async (e) => {
      await e.executar(
        'DELETE FROM pin_troca_rapida WHERE estabelecimento_id IN (SELECT id FROM estabelecimento WHERE codigo = ?)',
        [HOSPITAL],
      );
      await e.executar(
        "DELETE FROM idempotencia_operacao WHERE operacao LIKE 'acesso.pin.%' AND chave LIKE 'pin:%'",
      );
    });
  }

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE)).banco).toBe(BANCO);
    const presente = sql(
      `SELECT TABLE_COMMENT FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pin_troca_rapida'`,
      '-N',
    ).trim();
    if (!presente) {
      sql(
        readFileSync(resolve(RAIZ, 'docs/obra/fatias/f22/saida/03-02-pin.sql'), 'utf8').replace(
          /\) COMMENT='/g,
          `) COMMENT='${MARCA} `,
        ),
      );
      criadaPeloTeste = true;
    } else criadaPeloTeste = presente.includes(MARCA);
    await limpar();
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'f22-0302-pin-preparo' }, async (e) => {
      const agora = new Date();
      const garantir = async (sel: string, p: unknown[], ins: string, pi: unknown[]) => {
        const l = await e.uma<{ id: number }>(sel, p);
        return l ? Number(l.id) : e.inserir(ins, pi);
      };
      ids.est = await garantir(
        'SELECT id FROM estabelecimento WHERE codigo = ?',
        [HOSPITAL],
        'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
        [HOSPITAL, 'Hospital de teste do PIN', 'Hospital de teste do PIN (fictício)', agora],
      );
      const usu = (login: string) =>
        garantir(
          'SELECT id FROM usuario WHERE login = ?',
          [login],
          "INSERT INTO usuario (login, nome, tipo_conta, dispensa_cpf, criado_em) VALUES (?, ?, 'pessoa', TRUE, ?)",
          [login, 'USUARIO F22L0302P', agora],
        );
      ids.usuario = await usu(LOGIN);
      ids.admin = await usu(ADMIN);
    });
  }, 60_000);

  afterAll(async () => {
    if (!nucleo) return;
    try {
      await limpar();
    } finally {
      await nucleo.encerrar();
      if (criadaPeloTeste) sql('DROP TABLE IF EXISTS pin_troca_rapida');
    }
  });

  const propria = () =>
    new PortaPinPropria(nucleo, (_rede, h) => ({
      cliente: CLIENTE,
      estabelecimento: h === HOSPITAL ? ids.est : null,
    }));
  const fabricas: [string, () => PortaPin][] = [
    ['memória', () => portaPinMemoria()],
    ['banco', propria],
  ];
  const novo = (k: number, motivo = 'teste') => ({
    idUsuario: ids.usuario,
    login: LOGIN,
    hashPhc: RESUMO(k),
    por: ADMIN,
    motivo,
  });

  describe.each(fabricas)('%s', (nome, fabrica) => {
    it('definir, trocar, errar até bloquear, acertar no bloqueado e retirar', async () => {
      if (nome === 'banco') await limpar();
      const porta = fabrica();
      expect(await porta.situacao('f22', HOSPITAL, LOGIN)).toMatchObject({ definido: false, falhas: 0 });
      expect(
        await codigoDaRecusa(porta.definir('f22', HOSPITAL, { ...novo(1), hashPhc: 'claro' }, trilha('pin'))),
      ).toBe('pin-sem-cifra');
      expect((await porta.definir('f22', HOSPITAL, novo(1), trilha('pin.definir'))).anterior).toBe('nenhum');
      const segundo = await porta.definir('f22', HOSPITAL, novo(2), trilha('pin.definir'));
      expect(segundo.anterior).toBe('definido');
      expect(await porta.vivo('f22', HOSPITAL, LOGIN)).toMatchObject({
        id: segundo.id,
        hashPhc: RESUMO(2),
        definido: true,
        bloqueado: false,
      });
      const conf = (certo: boolean) =>
        porta.conferencia(
          'f22',
          HOSPITAL,
          { id: segundo.id, login: LOGIN, certo, teto: 3 },
          trilha('pin.conferencia'),
        );
      expect(await conf(false)).toEqual({ aceito: false, falhas: 1, bloqueouAgora: false });
      expect(await conf(true)).toEqual({ aceito: true, falhas: 0, bloqueouAgora: false });
      expect(await conf(false)).toEqual({ aceito: false, falhas: 1, bloqueouAgora: false });
      expect(await conf(false)).toEqual({ aceito: false, falhas: 2, bloqueouAgora: false });
      expect(await conf(false)).toEqual({ aceito: false, falhas: 3, bloqueouAgora: true });
      expect(await conf(true)).toEqual({ aceito: false, falhas: null, bloqueouAgora: false });
      expect(await porta.situacao('f22', HOSPITAL, LOGIN)).toMatchObject({
        definido: true,
        bloqueado: true,
        falhas: 3,
      });
      expect(
        await porta.retirar(
          'f22',
          HOSPITAL,
          { login: LOGIN, por: ADMIN, motivo: 'teste' },
          trilha('pin.retirar'),
        ),
      ).toEqual({ id: segundo.id, anterior: 'bloqueado' });
      expect(await porta.vivo('f22', HOSPITAL, LOGIN)).toBeNull();
      expect(
        await codigoDaRecusa(
          porta.retirar('f22', HOSPITAL, { login: LOGIN, por: ADMIN, motivo: 'x' }, trilha('pin')),
        ),
      ).toBe('sem-pin');
    });
  });

  it('no banco: uma linha por PIN, o resumo só na viva, a versão, a trilha; outro estabelecimento e conta inexistente', async () => {
    await limpar();
    const porta = propria();
    const a = await porta.definir('f22', HOSPITAL, novo(1, 'troca'), trilha('pin.definir'));
    const b = await porta.definir('f22', HOSPITAL, novo(2, 'troca'), trilha('pin.definir'));
    await porta.conferencia(
      'f22',
      HOSPITAL,
      { id: b.id, login: LOGIN, certo: false, teto: 5 },
      trilha('pin.conferencia'),
    );
    const linhas = await nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'f22-0302-pin-efeito' }, (l) =>
      l.consultar(
        `SELECT id, situacao, resumo_pin IS NOT NULL AS com_resumo, tentativas_invalidas, versao,
                encerrado_em IS NOT NULL AS encerrado, motivo_encerramento, usuario_id, criado_por
           FROM pin_troca_rapida WHERE estabelecimento_id = ? ORDER BY id`,
        [ids.est],
      ),
    );
    expect(
      linhas.map((x) => [
        String(x['id']),
        x['situacao'],
        Number(x['com_resumo']),
        Number(x['tentativas_invalidas']),
        Number(x['versao']),
        Number(x['encerrado']),
        x['motivo_encerramento'],
      ]),
    ).toEqual([
      [a.id, 'substituido', 0, 0, 2, 1, 'troca'],
      [b.id, 'vivo', 1, 1, 2, 0, null],
    ]);
    expect(Number(linhas[1]!['usuario_id'])).toBe(ids.usuario);
    expect(Number(linhas[1]!['criado_por'])).toBe(ids.admin);
    const trilhas = await nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'f22-0302-pin-efeito' }, (l) =>
      l.uma(
        "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'pin_troca_rapida' AND entidade_id IN (?, ?)",
        [a.id, b.id],
      ),
    );
    expect(Number(trilhas?.['n'])).toBeGreaterThanOrEqual(3);
    expect(await codigoDaRecusa(porta.situacao('f22', 'outro-hospital', LOGIN))).toBe('sem-estabelecimento');
    expect(
      await codigoDaRecusa(
        porta.definir('f22', HOSPITAL, { ...novo(3), idUsuario: ids.admin }, trilha('pin.definir')),
      ),
    ).toBe('usuario-inexistente');
    // O PIN não é conferido por outro login.
    expect(
      await porta.conferencia('f22', HOSPITAL, { id: b.id, login: ADMIN, certo: true }, trilha('pin')),
    ).toEqual({
      aceito: false,
      falhas: null,
      bloqueouAgora: false,
    });
  });
});
