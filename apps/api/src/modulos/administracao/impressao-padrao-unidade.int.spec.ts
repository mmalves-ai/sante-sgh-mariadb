// Contrato de efeito do padrão de impressora por UNIDADE (01-ADM L79) no MariaDB: o padrão da unidade e o geral do
// estabelecimento são linhas próprias por finalidade (um escopo cada, trocar altera a linha e nunca apaga); a
// reimpressão pela estação da unidade sai na impressora da unidade, a estação sem unidade sai no geral; a impressora
// da unidade inativa devolve ao geral; unidade de outro estabelecimento é recusada. Massa sintética (prefixo L79U);
// nenhum dado real.
import { randomUUID } from 'node:crypto';
import { ErroOperacao, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ErroProblema } from '../../problema.filter.js';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { FonteAdministracaoPropria } from './fonte-propria.js';
import type { ContextoGestao } from './tipos.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o2';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const P = 'L79U';

async function codigo(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'gravou';
  } catch (e) {
    if (e instanceof ErroOperacao) return String(e.problema.codigo ?? '');
    if (e instanceof ErroProblema) return String(e.extras?.['codigo'] ?? e.tipo);
    return `outro: ${(e as Error)?.message ?? ''}`;
  }
}

describe.skipIf(SEM_BANCO)('padrão de impressora por unidade no banco próprio (cliente f22_o2)', () => {
  const nucleo = new NucleoProprio();
  let fonte: FonteAdministracaoPropria;
  const ids = {
    est: 0,
    outroEst: 0,
    gestor: 0,
    unidade: 0,
    unidadeFora: 0,
    estUnidade: 0,
    estGeral: 0,
    impGeral: 0,
    impUnidade: 0,
    impUnidade2: 0,
    fin: 0,
    motivo: 0,
    etiqueta: 0,
  };
  const ctx = (): ContextoGestao => ({
    rede: 'rede-sint',
    hospital: P,
    correlacao: 'teste-l79u',
    login: `${P}.GESTOR`,
    usuario: ids.gestor,
    chaveIdempotencia: `tl79u-${randomUUID()}`,
    estacao: 'teste',
  });
  const um = (sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'teste-l79u' }, (l) => l.uma(sql, p));
  const exec = (nome: string, entrada: unknown) => fonte.executar(nome, entrada, ctx());
  const reimp = async (estacao: number) =>
    Number(
      (
        await exec('impressao.registrarReimpressao', {
          entidade: 'etiqueta_identificacao',
          entidadeId: ids.etiqueta,
          motivo: ids.motivo,
          finalidade: ids.fin,
          estacao,
        })
      )['impressora'],
    );

  async function limpar(): Promise<void> {
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-teste-l79u' }, async (e) => {
      await e.executar('DELETE FROM registro_reimpressao WHERE estabelecimento_id = ?', [ids.est]);
      await e.executar('DELETE FROM impressora_finalidade_estabelecimento WHERE estabelecimento_id = ?', [
        ids.est,
      ]);
      await e.executar('UPDATE impressora SET ativo = TRUE WHERE estabelecimento_id = ? AND codigo LIKE ?', [
        ids.est,
        `${P}%`,
      ]);
      await limparTrilhaDaMassa(e, { codigos: [P] });
    });
  }

  beforeAll(async () => {
    if ((await nucleo.cliente(CLIENTE)).banco !== `cliente_${CLIENTE}`)
      throw new Error('Cliente de teste inesperado.');
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-teste-l79u' }, async (e) => {
      const agora = new Date();
      const g = async (sel: string, p: unknown[], ins: string, pi: unknown[]) => {
        const l = await e.uma<{ id: number }>(sel, p);
        return l ? Number(l.id) : e.inserir(ins, pi);
      };
      const estab = (cod: string) =>
        g(
          'SELECT id FROM estabelecimento WHERE codigo = ?',
          [cod],
          'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
          [cod, `ESTAB ${cod} SINTETICO`, `ESTAB ${cod} SINTETICO`, agora],
        );
      ids.est = await estab(P);
      ids.outroEst = await estab(`${P}B`);
      ids.gestor = await g(
        'SELECT id FROM usuario WHERE login = ?',
        [`${P}.GESTOR`],
        "INSERT INTO usuario (login, nome, dispensa_cpf, tipo_conta, criado_em) VALUES (?, 'GESTOR SINTETICO', TRUE, 'pessoa', ?)",
        [`${P}.GESTOR`, agora],
      );
      await g(
        'SELECT id FROM usuario_estabelecimento WHERE usuario_id = ? AND estabelecimento_id = ?',
        [ids.gestor, ids.est],
        'INSERT INTO usuario_estabelecimento (usuario_id, estabelecimento_id, vigencia_inicio, criado_em) VALUES (?, ?, ?, ?)',
        [ids.gestor, ids.est, '2020-01-01', agora],
      );
      const unidade = (est: number, cod: string) =>
        g(
          'SELECT id FROM unidade_assistencial WHERE estabelecimento_id = ? AND codigo = ?',
          [est, cod],
          "INSERT INTO unidade_assistencial (estabelecimento_id, codigo, nome, tipo_unidade, criado_em) VALUES (?, ?, 'UNIDADE SINTETICA', 'internacao', ?)",
          [est, cod, agora],
        );
      ids.unidade = await unidade(ids.est, `${P}UN`);
      ids.unidadeFora = await unidade(ids.outroEst, `${P}UF`);
      const estacao = (cod: string, un: number | null) =>
        g(
          'SELECT id FROM estacao_trabalho WHERE estabelecimento_id = ? AND codigo = ?',
          [ids.est, cod],
          "INSERT INTO estacao_trabalho (estabelecimento_id, codigo, nome, unidade_assistencial_id, criado_em) VALUES (?, ?, 'ESTACAO SINTETICA', ?, ?)",
          [ids.est, cod, un, agora],
        );
      ids.estUnidade = await estacao(`${P}EU`, ids.unidade);
      ids.estGeral = await estacao(`${P}EG`, null);
      const imp = (cod: string) =>
        g(
          'SELECT id FROM impressora WHERE estabelecimento_id = ? AND codigo = ?',
          [ids.est, cod],
          "INSERT INTO impressora (estabelecimento_id, codigo, nome, tipo, conexao, criado_em) VALUES (?, ?, 'IMPRESSORA SINTETICA', 'etiqueta', 'local', ?)",
          [ids.est, cod, agora],
        );
      ids.impGeral = await imp(`${P}G`);
      ids.impUnidade = await imp(`${P}U`);
      ids.impUnidade2 = await imp(`${P}U2`);
      ids.fin = await g(
        'SELECT id FROM finalidade_impressao WHERE codigo = ?',
        [`${P}FIN`],
        "INSERT INTO finalidade_impressao (codigo, descricao, tipo_midia, criado_em) VALUES (?, 'ETIQUETA SINTETICA', 'etiqueta', ?)",
        [`${P}FIN`, agora],
      );
      ids.motivo = await g(
        'SELECT id FROM motivo_reimpressao WHERE codigo = ?',
        [`${P}M`],
        "INSERT INTO motivo_reimpressao (codigo, descricao, exige_complemento, criado_em) VALUES (?, 'MOTIVO SINTETICO', FALSE, ?)",
        [`${P}M`, agora],
      );
      const insumo = await e.uma<{ id: number }>('SELECT MIN(id) AS id FROM insumo', []);
      const medida = await e.uma<{ id: number }>('SELECT MIN(id) AS id FROM unidade_medida', []);
      ids.etiqueta = await g(
        'SELECT id FROM etiqueta_identificacao WHERE estabelecimento_id = ? AND identificador = ?',
        [ids.est, `${P}-ET`],
        'INSERT INTO etiqueta_identificacao (estabelecimento_id, identificador, insumo_id, unidade_medida_id, impressoes, criado_em) VALUES (?, ?, ?, ?, 1, ?)',
        [ids.est, `${P}-ET`, insumo?.id, medida?.id, agora],
      );
    });
    fonte = new FonteAdministracaoPropria(nucleo, CLIENTE, { rede: 'rede-sint' });
    await fonte.carregar();
    await limpar();
  });

  afterAll(async () => {
    await limpar();
    await nucleo.encerrar();
  });

  it('a unidade tem padrão próprio; a estação sem unidade usa o geral; trocar altera a linha; inativa volta ao geral', async () => {
    await exec('impressao.definirPadraoEstabelecimento', { finalidade: ids.fin, impressora: ids.impGeral });
    await exec('impressao.definirPadraoEstabelecimento', {
      finalidade: ids.fin,
      impressora: ids.impUnidade,
      unidade: ids.unidade,
      copias: 2,
    });
    const linhas = async () =>
      um(
        `SELECT COUNT(*) AS n, SUM(unidade_assistencial_id IS NULL) AS geral,
                MAX(CASE WHEN unidade_assistencial_id = ? THEN impressora_id END) AS imp_un,
                MAX(CASE WHEN unidade_assistencial_id = ? THEN copias END) AS copias_un,
                MAX(CASE WHEN unidade_assistencial_id = ? THEN id END) AS id_un
           FROM impressora_finalidade_estabelecimento WHERE estabelecimento_id = ? AND finalidade_impressao_id = ?`,
        [ids.unidade, ids.unidade, ids.unidade, ids.est, ids.fin],
      );
    const antes = await linhas();
    expect(Number(antes?.['n'])).toBe(2);
    expect(Number(antes?.['geral'])).toBe(1);
    expect(Number(antes?.['imp_un'])).toBe(ids.impUnidade);
    expect(Number(antes?.['copias_un'])).toBe(2);

    expect(await reimp(ids.estUnidade)).toBe(ids.impUnidade);
    expect(await reimp(ids.estGeral)).toBe(ids.impGeral);

    // Trocar a impressora da unidade altera a mesma linha (nada apagado, nenhum escopo duplicado).
    await exec('impressao.definirPadraoEstabelecimento', {
      finalidade: ids.fin,
      impressora: ids.impUnidade2,
      unidade: ids.unidade,
    });
    const depois = await linhas();
    expect(Number(depois?.['n'])).toBe(2);
    expect(Number(depois?.['id_un'])).toBe(Number(antes?.['id_un']));
    expect(Number(depois?.['imp_un'])).toBe(ids.impUnidade2);
    expect(await reimp(ids.estUnidade)).toBe(ids.impUnidade2);

    // A impressora da unidade inativa deixa de contar: a estação da unidade sai no geral.
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'teste-l79u' }, (e) =>
      e.executar('UPDATE impressora SET ativo = FALSE WHERE id = ?', [ids.impUnidade2]),
    );
    expect(await reimp(ids.estUnidade)).toBe(ids.impGeral);

    // Cada reimpressão registrou a estação e a impressora resolvida, com via crescente.
    const reg = await um(
      `SELECT COUNT(*) AS n, MAX(via) AS via, SUM(estacao_trabalho_id = ?) AS na_unidade
         FROM registro_reimpressao WHERE estabelecimento_id = ? AND entidade = 'etiqueta_identificacao' AND entidade_id = ?`,
      [ids.estUnidade, ids.est, ids.etiqueta],
    );
    expect(Number(reg?.['n'])).toBe(4);
    expect(Number(reg?.['via'])).toBe(5);
    expect(Number(reg?.['na_unidade'])).toBe(3);
  });

  it('unidade de outro estabelecimento é recusada e nada é gravado', async () => {
    const antes = await um(
      'SELECT COUNT(*) AS n FROM impressora_finalidade_estabelecimento WHERE estabelecimento_id = ?',
      [ids.est],
    );
    expect(
      await codigo(
        exec('impressao.definirPadraoEstabelecimento', {
          finalidade: ids.fin,
          impressora: ids.impGeral,
          unidade: ids.unidadeFora,
        }),
      ),
    ).toBe('unidade-inexistente');
    const depois = await um(
      'SELECT COUNT(*) AS n FROM impressora_finalidade_estabelecimento WHERE estabelecimento_id = ?',
      [ids.est],
    );
    expect(Number(depois?.['n'])).toBe(Number(antes?.['n']));
  });
});
