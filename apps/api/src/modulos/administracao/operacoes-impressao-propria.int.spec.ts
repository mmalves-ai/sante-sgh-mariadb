// Contrato de efeito da impressora por estação e da reimpressão (01-ADM L79) no MariaDB: o vínculo novo vira o
// padrão e o anterior fica guardado (sem apagar); a reimpressão grava motivo, complemento, via crescente, destino e
// a impressora resolvida pela estação; motivo que exige complemento sem ele e impressora de fora são recusados.
// Correção: a reimpressão prova a 1ª impressão pelo próprio documento (etiqueta com impressões), recusa documento de
// outro estabelecimento, documento emitido e finalidade inexistentes; a escolha da impressora é provada por nível
// (estabelecimento, estação, usuário) e com a impressora inativa saindo; preferência de usuário sem vínculo recusa.
// Massa sintética (prefixo L79I); nenhum dado real.
import { randomUUID } from 'node:crypto';
import { ErroOperacao, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ErroProblema } from '../../problema.filter.js';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { FonteAdministracaoPropria } from './fonte-propria.js';
import type { ContextoGestao } from './tipos.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o2';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const P = 'L79I';

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

describe.skipIf(SEM_BANCO)('impressora por estação e reimpressão no banco próprio (cliente f22_o2)', () => {
  const nucleo = new NucleoProprio();
  let fonte: FonteAdministracaoPropria;
  const ids = { est: 0, outroEst: 0, gestor: 0, estacao: 0, imp1: 0, imp2: 0, impFora: 0, fin: 0 };
  const ids2 = { motivo: 0, motivoComp: 0 };
  const ids3 = { imp3: 0, fin2: 0, semVinculo: 0, et1: 0, et2: 0, etNunca: 0, etFora: 0 };
  const ctx = (): ContextoGestao => ({
    rede: 'rede-sint',
    hospital: P,
    correlacao: 'teste-l79i',
    login: `${P}.GESTOR`,
    usuario: ids.gestor,
    chaveIdempotencia: `tl79i-${randomUUID()}`,
    estacao: 'teste',
  });
  const um = (sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'teste-l79i' }, (l) => l.uma(sql, p));
  const exec = (nome: string, entrada: unknown) => fonte.executar(nome, entrada, ctx());

  async function limpar(): Promise<void> {
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-teste-l79i' }, async (e) => {
      await e.executar('DELETE FROM registro_reimpressao WHERE estabelecimento_id IN (?, ?)', [
        ids.est,
        ids.outroEst,
      ]);
      await e.executar(
        'DELETE FROM estacao_impressora WHERE estacao_trabalho_id IN (SELECT id FROM estacao_trabalho WHERE codigo = ?)',
        [`${P}E`],
      );
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
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-teste-l79i' }, async (e) => {
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
      ids.estacao = await g(
        'SELECT id FROM estacao_trabalho WHERE estabelecimento_id = ? AND codigo = ?',
        [ids.est, `${P}E`],
        "INSERT INTO estacao_trabalho (estabelecimento_id, codigo, nome, criado_em) VALUES (?, ?, 'ESTACAO SINTETICA', ?)",
        [ids.est, `${P}E`, agora],
      );
      const imp = (est: number, cod: string) =>
        g(
          'SELECT id FROM impressora WHERE estabelecimento_id = ? AND codigo = ?',
          [est, cod],
          "INSERT INTO impressora (estabelecimento_id, codigo, nome, tipo, conexao, criado_em) VALUES (?, ?, 'IMPRESSORA SINTETICA', 'etiqueta', 'local', ?)",
          [est, cod, agora],
        );
      ids.imp1 = await imp(ids.est, `${P}1`);
      ids.imp2 = await imp(ids.est, `${P}2`);
      ids.impFora = await imp(ids.outroEst, `${P}F`);
      ids.fin = await g(
        'SELECT id FROM finalidade_impressao WHERE codigo = ?',
        [`${P}FIN`],
        "INSERT INTO finalidade_impressao (codigo, descricao, tipo_midia, criado_em) VALUES (?, 'ETIQUETA SINTETICA', 'etiqueta', ?)",
        [`${P}FIN`, agora],
      );
      const motivo = (cod: string, comp: boolean) =>
        g(
          'SELECT id FROM motivo_reimpressao WHERE codigo = ?',
          [cod],
          "INSERT INTO motivo_reimpressao (codigo, descricao, exige_complemento, criado_em) VALUES (?, 'MOTIVO SINTETICO', ?, ?)",
          [cod, comp, agora],
        );
      ids2.motivo = await motivo(`${P}M`, false);
      ids2.motivoComp = await motivo(`${P}MC`, true);
      ids3.imp3 = await imp(ids.est, `${P}3`);
      ids3.fin2 = await g(
        'SELECT id FROM finalidade_impressao WHERE codigo = ?',
        [`${P}FIN2`],
        "INSERT INTO finalidade_impressao (codigo, descricao, tipo_midia, criado_em) VALUES (?, 'PULSEIRA SINTETICA', 'etiqueta', ?)",
        [`${P}FIN2`, agora],
      );
      ids3.semVinculo = await g(
        'SELECT id FROM usuario WHERE login = ?',
        [`${P}.SEMV`],
        "INSERT INTO usuario (login, nome, dispensa_cpf, tipo_conta, criado_em) VALUES (?, 'SEM VINCULO SINTETICO', TRUE, 'pessoa', ?)",
        [`${P}.SEMV`, agora],
      );
      // Etiquetas sintéticas: a prova da 1ª impressão é o contador de impressões da própria etiqueta.
      const insumo = await e.uma<{ id: number }>('SELECT MIN(id) AS id FROM insumo', []);
      const um = await e.uma<{ id: number }>('SELECT MIN(id) AS id FROM unidade_medida', []);
      const etiqueta = (est: number, cod: string, impressoes: number) =>
        g(
          'SELECT id FROM etiqueta_identificacao WHERE estabelecimento_id = ? AND identificador = ?',
          [est, cod],
          'INSERT INTO etiqueta_identificacao (estabelecimento_id, identificador, insumo_id, unidade_medida_id, impressoes, criado_em) VALUES (?, ?, ?, ?, ?, ?)',
          [est, cod, insumo?.id, um?.id, impressoes, agora],
        );
      ids3.et1 = await etiqueta(ids.est, `${P}-ET1`, 1);
      ids3.et2 = await etiqueta(ids.est, `${P}-ET2`, 1);
      ids3.etNunca = await etiqueta(ids.est, `${P}-ET0`, 0);
      ids3.etFora = await etiqueta(ids.outroEst, `${P}-ETF`, 1);
    });
    fonte = new FonteAdministracaoPropria(nucleo, CLIENTE, { rede: 'rede-sint' });
    await fonte.carregar();
    await limpar();
  });

  afterAll(async () => {
    await limpar();
    await nucleo.encerrar();
  });

  it('as receitas da impressão aparecem ligadas', () => {
    for (const n of ['impressao.vincularEstacao', 'impressao.registrarReimpressao'])
      expect(fonte.receita(n).ligada).toBe(true);
  });

  it('vincular: o novo vira o padrão e o anterior fica guardado; impressora de outro estabelecimento é recusada', async () => {
    const base = { estacao: ids.estacao, finalidade: ids.fin };
    await exec('impressao.vincularEstacao', { ...base, impressora: ids.imp1 });
    await exec('impressao.vincularEstacao', { ...base, impressora: ids.imp2 });
    const l = await um(
      `SELECT COUNT(*) AS n, SUM(padrao) AS padroes, MAX(CASE WHEN padrao THEN impressora_id END) AS atual
         FROM estacao_impressora WHERE estacao_trabalho_id = ? AND finalidade_impressao_id = ? AND excluido_em IS NULL`,
      [ids.estacao, ids.fin],
    );
    expect(Number(l?.['n'])).toBe(2);
    expect(Number(l?.['padroes'])).toBe(1);
    expect(Number(l?.['atual'])).toBe(ids.imp2);
    expect(await codigo(exec('impressao.vincularEstacao', { ...base, impressora: ids.impFora }))).toBe(
      'impressora-de-outro-estabelecimento',
    );
  });

  it('reimprimir: motivo, via crescente e a impressora da estação; complemento exigido pelo motivo', async () => {
    const doc = {
      entidade: 'etiqueta_identificacao',
      entidadeId: ids3.et1,
      finalidade: ids.fin,
      estacao: ids.estacao,
    };
    expect(await codigo(exec('impressao.registrarReimpressao', { ...doc, motivo: ids2.motivoComp }))).toBe(
      'complemento-obrigatorio',
    );
    const r1 = await exec('impressao.registrarReimpressao', { ...doc, motivo: ids2.motivo });
    const r2 = await exec('impressao.registrarReimpressao', {
      ...doc,
      motivo: ids2.motivoComp,
      complemento: 'Etiqueta borrada',
    });
    expect(r1['via']).toBe(2);
    expect(r2['via']).toBe(3);
    const l = await um(
      `SELECT via, motivo_reimpressao_id, motivo_texto, destino, impressora_id, estacao_trabalho_id, usuario_id
         FROM registro_reimpressao WHERE id = ?`,
      [r2['id']],
    );
    expect(l).toMatchObject({ motivo_texto: 'Etiqueta borrada', destino: 'impressora' });
    expect(Number(l?.['motivo_reimpressao_id'])).toBe(ids2.motivoComp);
    expect(Number(l?.['impressora_id'])).toBe(ids.imp2);
    expect(Number(l?.['estacao_trabalho_id'])).toBe(ids.estacao);
    expect(Number(l?.['usuario_id'])).toBe(ids.gestor);
    const n = await um(
      'SELECT COUNT(*) AS n FROM registro_reimpressao WHERE entidade = ? AND entidade_id = ?',
      [doc.entidade, doc.entidadeId],
    );
    expect(Number(n?.['n'])).toBe(2);
  });

  it('reimprimir: recusa nunca impresso, documento de outro estabelecimento, emitido e finalidade inexistentes, impressora de fora', async () => {
    const base = { entidade: 'etiqueta_identificacao', motivo: ids2.motivo };
    const rr = (x: object) => codigo(exec('impressao.registrarReimpressao', { ...base, ...x }));
    expect(await rr({ entidadeId: ids3.etNunca })).toBe('documento-nunca-impresso');
    expect(await rr({ entidadeId: ids3.etFora })).toBe('documento-inexistente');
    expect(await rr({ entidadeId: 999999999 })).toBe('documento-inexistente');
    expect(await rr({ entidadeId: ids3.et1, documentoEmitido: 999999999 })).toBe(
      'documento-emitido-inexistente',
    );
    expect(await rr({ entidadeId: ids3.et1, finalidade: 999999999 })).toBe('finalidade-inexistente');
    expect(await rr({ entidadeId: ids3.et1, impressora: ids.impFora })).toBe(
      'impressora-de-outro-estabelecimento',
    );
    expect(await rr({ entidade: 'usuario', entidadeId: ids.gestor })).toMatch(/^outro|entrada|invalid/);
    const n = await um('SELECT COUNT(*) AS n FROM registro_reimpressao WHERE entidade_id IN (?, ?)', [
      ids3.etNunca,
      ids3.etFora,
    ]);
    expect(Number(n?.['n'])).toBe(0);
  });

  it('escolha por nível: estabelecimento, estação, usuário; impressora inativa sai; usuário sem vínculo recusa', async () => {
    const reimp = async () =>
      Number(
        (
          await exec('impressao.registrarReimpressao', {
            entidade: 'etiqueta_identificacao',
            entidadeId: ids3.et2,
            motivo: ids2.motivo,
            finalidade: ids3.fin2,
            estacao: ids.estacao,
          })
        )['impressora'],
      );
    await exec('impressao.definirPadraoEstabelecimento', { finalidade: ids3.fin2, impressora: ids.imp1 });
    expect(await reimp()).toBe(ids.imp1);
    const padrao = await um(
      `SELECT COUNT(*) AS n, MAX(impressora_id) AS imp FROM impressora_finalidade_estabelecimento
        WHERE estabelecimento_id = ? AND finalidade_impressao_id = ?`,
      [ids.est, ids3.fin2],
    );
    expect(Number(padrao?.['n'])).toBe(1);
    expect(Number(padrao?.['imp'])).toBe(ids.imp1);
    expect(
      await codigo(
        exec('impressao.definirPadraoEstabelecimento', { finalidade: ids3.fin2, impressora: ids.impFora }),
      ),
    ).toBe('impressora-de-outro-estabelecimento');
    await exec('impressao.vincularEstacao', {
      estacao: ids.estacao,
      finalidade: ids3.fin2,
      impressora: ids.imp2,
    });
    expect(await reimp()).toBe(ids.imp2);
    expect(
      await codigo(
        exec('impressao.vincularEstacao', {
          estacao: ids.estacao,
          finalidade: ids3.fin2,
          impressora: ids3.imp3,
          usuario: ids3.semVinculo,
        }),
      ),
    ).toBe('usuario-sem-vinculo');
    await exec('impressao.vincularEstacao', {
      estacao: ids.estacao,
      finalidade: ids3.fin2,
      impressora: ids3.imp3,
      usuario: ids.gestor,
    });
    expect(await reimp()).toBe(ids3.imp3);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'teste-l79i' }, (e) =>
      e.executar('UPDATE impressora SET ativo = FALSE WHERE id = ?', [ids3.imp3]),
    );
    expect(await reimp()).toBe(ids.imp2);
  });
});
