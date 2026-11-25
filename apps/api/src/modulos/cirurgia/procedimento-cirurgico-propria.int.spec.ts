// Contrato de efeito do cadastro do procedimento cirúrgico (F3.4, 04-CC linha 91) contra o MariaDB real (cliente de
// teste). Massa SINTÉTICA: estabelecimento com o código do teste (para a sessão e a trilha), um grupo e dois portes
// fictícios (um em uso e um fora de uso); usuário, especialidade e caráter são ids já existentes do cliente de teste
// (só lidos, nunca alterados). Prova o que fica no banco: a inclusão com o código em maiúsculas, os cadastros ligados
// (grupo, porte, especialidade, caráter) e origem 'sistema'; o código repetido recusado (409) sem linha nova; a regra
// do domínio (sem porte) e o porte fora de uso recusados (422) sem escrita; a alteração com a versão +1 e a versão
// velha recusada; tirar de uso e voltar sem apagar; a lista (busca, fora de uso só com "todos") e a trilha.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { PortaProcedimentoCirurgicoPropria } from './procedimento-cirurgico-propria.js';

const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o4';
const P = 'c1089pc';
const COD = 'C1089PC-001';

interface Massa {
  usuario: number;
  grupo: number;
  porte: number;
  porteInativo: number;
  especialidade: number;
  carater: number;
}

async function limpar(e: Escritor): Promise<void> {
  await e.executar('DELETE FROM procedimento_cirurgico WHERE codigo LIKE ?', ['C1089PC-%']);
  await e.executar('DELETE FROM porte_cirurgico WHERE codigo LIKE ?', [`${P}-%`]);
  await e.executar('DELETE FROM grupo_procedimento_cirurgico WHERE codigo LIKE ?', [`${P}-%`]);
  await limparTrilhaDaMassa(e, { codigos: [P] });
  await e.executar('DELETE FROM estabelecimento WHERE codigo = ?', [P]);
}

describe.skipIf(SEM_BANCO)('PortaProcedimentoCirurgicoPropria contra o MariaDB (contrato de efeito)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaProcedimentoCirurgicoPropria;
  let m: Massa;
  const ctx = () => ({ cliente: CLIENTE, hospital: P, usuario: m.usuario, correlacao: P });
  const ler = <T = Record<string, unknown>>(sql: string, p: unknown[] = []) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: P }, (l) => l.consultar(sql, p)) as Promise<T[]>;
  const contar = async (codigo: string) =>
    Number(
      (await ler('SELECT COUNT(*) AS n FROM procedimento_cirurgico WHERE codigo = ?', [codigo]))[0]!['n'],
    );

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await nucleo.escrever({ cliente: CLIENTE, correlacao: `preparo-${P}` }, async (e) => {
      await limpar(e);
      const agora = new Date();
      const usuario = await e.uma('SELECT MIN(id) AS id FROM usuario WHERE excluido_em IS NULL');
      const esp = await e.uma('SELECT MIN(id) AS id FROM especialidade_medica WHERE ativo = 1');
      const car = await e.uma('SELECT MIN(id) AS id FROM carater_cirurgia WHERE ativo = 1');
      if (!usuario?.['id'] || !esp?.['id'] || !car?.['id'])
        throw new Error('O cliente de teste precisa de usuário, especialidade e caráter de cirurgia em uso.');
      await e.inserir(
        `INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, fuso_horario, criado_em)
         VALUES (?, ?, ?, 'America/Sao_Paulo', ?)`,
        [P, `Hospital sintético ${P}`, `Hospital sintético ${P} (fictício)`, agora],
      );
      const grupo = await e.inserir(
        'INSERT INTO grupo_procedimento_cirurgico (codigo, descricao, criado_em) VALUES (?, ?, ?)',
        [`${P}-G`, 'GRUPO SINTETICO C1089', agora],
      );
      const porte = await e.inserir(
        `INSERT INTO porte_cirurgico (codigo, descricao, ativo, duracao_referencia_minutos, criado_em)
         VALUES (?, ?, 1, 120, ?)`,
        [`${P}-M`, 'PORTE SINTETICO C1089', agora],
      );
      const porteInativo = await e.inserir(
        'INSERT INTO porte_cirurgico (codigo, descricao, ativo, criado_em) VALUES (?, ?, 0, ?)',
        [`${P}-X`, 'PORTE SINTETICO FORA DE USO C1089', agora],
      );
      return {
        usuario: Number(usuario['id']),
        grupo,
        porte,
        porteInativo,
        especialidade: Number(esp['id']),
        carater: Number(car['id']),
      };
    });
    porta = new PortaProcedimentoCirurgicoPropria(nucleo, CLIENTE);
  }, 60_000);

  afterAll(async () => {
    if (nucleo) {
      await nucleo.escrever({ cliente: CLIENTE, correlacao: `limpeza-${P}` }, limpar);
      await nucleo.encerrar?.();
    }
  });

  const entrada = (extra: Record<string, unknown> = {}) => ({
    codigo: ` ${COD.toLowerCase()} `,
    descricao: 'Procedimento sintético C1089',
    mnemonico: 'SINT1089',
    natureza: 'terapeutica',
    grupo: m.grupo,
    porte: m.porte,
    especialidade: m.especialidade,
    carater: m.carater,
    duracaoMediaMinutos: 90,
    tempoPreparoSalaMinutos: 20,
    exigeLateralidade: true,
    ...extra,
  });

  it('inclui com o código normalizado e os cadastros ligados; recusa repetido, sem porte e porte fora de uso', async () => {
    const a = await porta.incluir(ctx(), entrada());
    const [la] = await ler(
      `SELECT codigo, natureza, grupo_procedimento_cirurgico_id, porte_cirurgico_id, especialidade_medica_id,
              carater_cirurgia_id, duracao_media_minutos, tempo_preparo_sala_minutos, exige_lateralidade, ativo,
              origem, versao, criado_por
         FROM procedimento_cirurgico WHERE id = ?`,
      [a.id],
    );
    expect(la).toMatchObject({ codigo: COD, natureza: 'terapeutica', origem: 'sistema' });
    expect(
      [
        'grupo_procedimento_cirurgico_id',
        'porte_cirurgico_id',
        'especialidade_medica_id',
        'carater_cirurgia_id',
        'duracao_media_minutos',
        'tempo_preparo_sala_minutos',
        'exige_lateralidade',
        'ativo',
        'versao',
        'criado_por',
      ].map((k) => Number(la![k])),
    ).toEqual([m.grupo, m.porte, m.especialidade, m.carater, 90, 20, 1, 1, 1, m.usuario]);

    await expect(porta.incluir(ctx(), entrada())).rejects.toMatchObject({ problema: { status: 409 } });
    await expect(porta.incluir(ctx(), entrada({ codigo: 'C1089PC-002', porte: null }))).rejects.toMatchObject(
      { problema: { status: 422 } },
    );
    await expect(
      porta.incluir(ctx(), entrada({ codigo: 'C1089PC-002', porte: m.porteInativo })),
    ).rejects.toMatchObject({ problema: { status: 422 } });
    await expect(
      porta.incluir(ctx(), entrada({ codigo: 'C1089PC-002', especialidade: 999_999_999 })),
    ).rejects.toMatchObject({ problema: { status: 404 } });
    expect(await contar(COD)).toBe(1);
    expect(await contar('C1089PC-002')).toBe(0);
  });

  it('altera com a versão, recusa a versão velha, tira de uso e volta sem apagar; a lista e a trilha', async () => {
    const [x] = await ler('SELECT id FROM procedimento_cirurgico WHERE codigo = ?', [COD]);
    const id = Number(x!['id']);
    await porta.alterar(ctx(), id, {
      ...entrada({
        carater: null,
        duracaoMediaMinutos: 150,
        descricao: 'Procedimento sintético C1089 alterado',
      }),
      versao: 1,
    });
    const [lb] = await ler(
      'SELECT descricao, carater_cirurgia_id, duracao_media_minutos, versao FROM procedimento_cirurgico WHERE id = ?',
      [id],
    );
    expect(lb).toMatchObject({
      descricao: 'Procedimento sintético C1089 alterado',
      carater_cirurgia_id: null,
    });
    expect([Number(lb!['duracao_media_minutos']), Number(lb!['versao'])]).toEqual([150, 2]);
    await expect(porta.alterar(ctx(), id, { ...entrada(), versao: 1 })).rejects.toMatchObject({
      problema: { status: 409 },
    });

    await porta.definirUso(ctx(), id, { ativo: false, versao: 2 });
    const [lc] = await ler('SELECT ativo, versao, excluido_em FROM procedimento_cirurgico WHERE id = ?', [
      id,
    ]);
    expect([Number(lc!['ativo']), Number(lc!['versao']), lc!['excluido_em']]).toEqual([0, 3, null]);
    expect((await porta.listar(ctx(), { q: 'C1089PC' })).itens.map((i) => i.id)).not.toContain(id);
    const todos = await porta.listar(ctx(), { q: 'c1089pc', todos: true });
    expect(todos.itens.find((i) => i.id === id)).toMatchObject({
      ativo: false,
      porteDescricao: 'PORTE SINTETICO C1089',
      grupoDescricao: 'GRUPO SINTETICO C1089',
      textosPadrao: 0,
    });
    await porta.definirUso(ctx(), id, { ativo: true, versao: 3 });
    expect((await porta.obter(ctx(), id)).ativo).toBe(true);

    const apoio = await porta.apoio(ctx());
    expect(apoio.portes.map((p) => p.id)).toContain(m.porte);
    expect(apoio.portes.map((p) => p.id)).not.toContain(m.porteInativo);
    expect(apoio.portes.find((p) => p.id === m.porte)?.duracaoReferenciaMinutos).toBe(120);

    const [tr] = await ler(
      `SELECT COUNT(*) AS n FROM trilha_auditoria
        WHERE estabelecimento_id = (SELECT id FROM estabelecimento WHERE codigo = ?)`,
      [P],
    );
    expect(Number(tr!['n'])).toBeGreaterThanOrEqual(4);
  });
});
