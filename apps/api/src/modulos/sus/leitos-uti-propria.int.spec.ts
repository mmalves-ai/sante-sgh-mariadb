// Contrato de efeito dos leitos de UTI habilitados (F7, 06-SUS linha 59) contra o MariaDB real (cliente de teste).
// Massa SINTÉTICA: estabelecimento com o código do teste e dois tipos de UTI fictícios no domínio SUS (removidos na
// limpeza); o usuário é um id já existente do cliente (só lido). Prova o que fica no banco: a inclusão com tipo,
// quantidade, vigência e quem gravou; as recusas sem gravar (vigência fora da competência, sobreposição, tipo e unidade
// inexistentes); a nova quantidade a partir de uma competência que encerra a anterior na véspera (as duas linhas
// ficam); a alteração da vigência com a versão lida (versão velha recusada); a inativação sem apagar; a leitura com a
// classe e o nível pela descrição; o isolamento por estabelecimento e a trilha da operação.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { PortaLeitosUtiPropria } from './leitos-uti-propria.js';

const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o5';
const P = 'c1068uti';
const P2 = 'c1068uti2';

async function limpar(e: Escritor): Promise<void> {
  await e.executar(
    'DELETE FROM leito_uti_habilitado WHERE estabelecimento_id IN (SELECT id FROM estabelecimento WHERE codigo IN (?, ?))',
    [P, P2],
  );
  await e.executar("DELETE FROM dominio_sus WHERE lista = 'tipo_leito_uti' AND codigo LIKE ?", [`${P}%`]);
  await limparTrilhaDaMassa(e, { codigos: [P, P2] });
  await e.executar('DELETE FROM estabelecimento WHERE codigo IN (?, ?)', [P, P2]);
}

describe.skipIf(SEM_BANCO)('PortaLeitosUtiPropria contra o MariaDB (contrato de efeito)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaLeitosUtiPropria;
  let m: { est: number; usuario: number; adulto: number; neo: number };
  const ctx = (hospital = P) => ({ cliente: CLIENTE, hospital, usuario: m.usuario, correlacao: P });
  const ler = <T = Record<string, unknown>>(sql: string, p: unknown[] = []) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: P }, (l) => l.consultar(sql, p)) as Promise<T[]>;
  const linhas = () =>
    ler(
      `SELECT id, tipo_uti_dominio_sus_id AS tipo, quantidade_leitos AS q, DATE_FORMAT(vigencia_inicio, '%Y-%m-%d') AS i,
              DATE_FORMAT(vigencia_fim, '%Y-%m-%d') AS f, ativo, versao, criado_por
         FROM leito_uti_habilitado WHERE estabelecimento_id = ? ORDER BY id`,
      [m.est],
    );

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await nucleo.escrever({ cliente: CLIENTE, correlacao: `preparo-${P}` }, async (e) => {
      await limpar(e);
      const agora = new Date();
      const usuario = await e.uma('SELECT MIN(id) AS id FROM usuario WHERE excluido_em IS NULL');
      if (!usuario?.['id']) throw new Error('O cliente de teste precisa de usuário.');
      const est = await e.inserir(
        `INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, fuso_horario, criado_em)
         VALUES (?, ?, ?, 'America/Sao_Paulo', ?)`,
        [P, `Hospital sintético ${P}`, `Hospital sintético ${P} (fictício)`, agora],
      );
      await e.inserir(
        `INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, fuso_horario, criado_em)
         VALUES (?, ?, ?, 'America/Sao_Paulo', ?)`,
        [P2, `Hospital sintético ${P2}`, `Hospital sintético ${P2} (fictício)`, agora],
      );
      const tipo = (cod: string, oficial: string, desc: string) =>
        e.inserir(
          `INSERT INTO dominio_sus (lista, codigo, codigo_oficial, descricao, criado_em)
           VALUES ('tipo_leito_uti', ?, ?, ?, ?)`,
          [`${P}${cod}`, oficial, desc, agora],
        );
      const adulto = await tipo('a2', '9875', 'UTI adulto tipo II (sintético)');
      const neo = await tipo('n3', '9882', 'UTI neonatal tipo III (sintético)');
      return { est, usuario: Number(usuario['id']), adulto, neo };
    });
    porta = new PortaLeitosUtiPropria(nucleo, CLIENTE);
  });

  afterAll(async () => {
    if (!nucleo) return;
    await nucleo.escrever({ cliente: CLIENTE, correlacao: `limpeza-${P}` }, limpar);
    await nucleo.encerrar?.();
  });

  let primeira = 0;
  let segunda = 0;

  it('inclui a habilitação e recusa sem gravar a vigência fora da competência, o tipo e a unidade inexistentes', async () => {
    const r = await porta.incluir(ctx(), {
      tipo: m.adulto,
      quantidadeLeitos: 10,
      vigenciaInicio: '2026-01-01',
    });
    primeira = r.id;
    expect(r.encerrada).toBeNull();
    expect(await linhas()).toEqual([
      expect.objectContaining({
        id: primeira,
        tipo: m.adulto,
        q: 10,
        i: '2026-01-01',
        f: null,
        ativo: 1,
        versao: 1,
        criado_por: m.usuario,
      }),
    ]);
    await expect(
      porta.incluir(ctx(), { tipo: m.neo, quantidadeLeitos: 4, vigenciaInicio: '2026-01-15' }),
    ).rejects.toMatchObject({ problema: { status: 422 } });
    await expect(
      porta.incluir(ctx(), { tipo: m.neo, quantidadeLeitos: 0, vigenciaInicio: '2026-01-01' }),
    ).rejects.toMatchObject({ problema: { status: 422 } });
    await expect(
      porta.incluir(ctx(), { tipo: 999_999_999, quantidadeLeitos: 4, vigenciaInicio: '2026-01-01' }),
    ).rejects.toMatchObject({ problema: { status: 404 } });
    await expect(
      porta.incluir(ctx(), {
        tipo: m.neo,
        unidade: 999_999_999,
        quantidadeLeitos: 4,
        vigenciaInicio: '2026-01-01',
      }),
    ).rejects.toMatchObject({ problema: { status: 404 } });
    await expect(porta.incluir(ctx(), { tipo: m.neo, quantidadeLeitos: 4 })).rejects.toMatchObject({
      problema: { status: 400 },
    });
    expect(await linhas()).toHaveLength(1);
  });

  it('a nova quantidade a partir de março encerra a anterior em fevereiro; a sobreposição é recusada', async () => {
    const r = await porta.incluir(ctx(), {
      tipo: m.adulto,
      quantidadeLeitos: 12,
      vigenciaInicio: '2026-03-01',
    });
    segunda = r.id;
    expect(r.encerrada).toBe(primeira);
    expect((await linhas()).map((x) => [x['id'], x['q'], x['i'], x['f'], x['versao']])).toEqual([
      [primeira, 10, '2026-01-01', '2026-02-28', 2],
      [segunda, 12, '2026-03-01', null, 1],
    ]);
    await expect(
      porta.incluir(ctx(), {
        tipo: m.adulto,
        quantidadeLeitos: 8,
        vigenciaInicio: '2026-02-01',
        vigenciaFim: '2026-02-28',
      }),
    ).rejects.toMatchObject({ problema: { status: 422 } });
    expect(await linhas()).toHaveLength(2);
  });

  it('altera a vigência com a versão lida e recusa a versão velha e a sobreposição', async () => {
    await porta.alterarVigencia(ctx(), segunda, {
      vigenciaInicio: '2026-03-01',
      vigenciaFim: '2026-12-31',
      liberaCritica: true,
      versao: 1,
    });
    const [s] = await ler(
      'SELECT vigencia_fim, libera_critica, versao, alterado_por FROM leito_uti_habilitado WHERE id = ?',
      [segunda],
    );
    expect(s).toMatchObject({ libera_critica: 1, versao: 2, alterado_por: m.usuario });
    await expect(
      porta.alterarVigencia(ctx(), segunda, { vigenciaInicio: '2026-03-01', vigenciaFim: null, versao: 1 }),
    ).rejects.toBeTruthy();
    await expect(
      porta.alterarVigencia(ctx(), segunda, {
        vigenciaInicio: '2026-02-01',
        vigenciaFim: '2026-12-31',
        versao: 2,
      }),
    ).rejects.toMatchObject({ problema: { status: 422 } });
  });

  it('inativa sem apagar; lê com classe e nível; outro estabelecimento não vê nem altera', async () => {
    const n = await porta.incluir(ctx(), { tipo: m.neo, quantidadeLeitos: 4, vigenciaInicio: '2026-01-01' });
    await porta.inativar(ctx(), n.id, { versao: 1 });
    await expect(porta.inativar(ctx(), n.id, { versao: 2 })).rejects.toMatchObject({
      problema: { status: 422 },
    });
    const lidas = await porta.listar(ctx());
    expect(lidas).toHaveLength(3);
    expect(lidas.find((x) => x.id === n.id)).toMatchObject({
      ativo: false,
      classe: 'neonatal',
      nivel: 3,
      tipoCodigo: '9882',
    });
    expect(lidas.find((x) => x.id === segunda)).toMatchObject({
      classe: 'adulto',
      nivel: 2,
      quantidadeLeitos: 12,
      liberaCritica: true,
    });
    const op = await porta.opcoes(ctx());
    expect(op.tipos.map((x) => x.id)).toEqual(expect.arrayContaining([m.adulto, m.neo]));
    expect(await porta.listar(ctx(P2))).toEqual([]);
    await expect(porta.inativar(ctx(P2), segunda, { versao: 2 })).rejects.toMatchObject({
      problema: { status: 404 },
    });
    const [t] = await ler<{ n: number }>(
      'SELECT COUNT(*) AS n FROM trilha_auditoria WHERE estabelecimento_id = ? AND usuario_id = ?',
      [m.est, m.usuario],
    );
    expect(Number(t!.n)).toBeGreaterThanOrEqual(4);
  });
});
