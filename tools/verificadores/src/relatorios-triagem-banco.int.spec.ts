// Integração da triagem dos relatórios contra o MariaDB real (cliente f22_o5, já criado pela obra; se faltar:
// `python3 -I tools/db/criar_cliente.py f22_o5 "Teste F2.2 onda 5"`). Massa sintética (estabelecimento de teste),
// apagada no fim. SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { randomUUID } from 'node:crypto';
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AREAS_TRIAGEM,
  gravarPropostasTriagem,
  propostaDoRelatorio,
  resumoTriagemGravada,
  type PropostaGravavel,
} from './relatorios-triagem-banco.ts';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o5';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const MODULOS = [0, 1, 4, 7, 8, 9, 10, 14, 15, 22, 23, 27, 99];

const proposta = (codigo: string, x: Partial<PropostaGravavel> = {}): PropostaGravavel => ({
  codigo,
  nome: `Relatorio de teste ${codigo}`,
  quantidadeParametros: 1,
  acessoRestrito: false,
  destino: 'catalogo',
  marco: 'M34',
  artefato: 'catalogo de relatorios',
  areaDona: 'faturamento',
  onda: 1,
  regra: 'teste',
  motivo: 'proposta de teste',
  ...x,
});
const vazio = { incluidas: 0, atualizadas: 0, preservadas: 0, inalteradas: 0, excluidasPreservadas: 0, ausentes: 0, codigosAusentes: '' };

describe.skipIf(SEM_BANCO)('triagem dos relatórios no banco próprio (cliente f22_o5)', () => {
  let nucleo: NucleoProprio;
  let est = 0;
  let est2 = 0;
  const ctx = (estabelecimento: number | null) => ({
    cliente: CLIENTE,
    estabelecimento,
    usuario: null,
    correlacao: 'f22-05-11',
    chaveIdempotencia: `t0511-${randomUUID()}`,
  });
  const linhas = (e = est) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'f22-05-11' }, (l) =>
      l.consultar<Record<string, unknown>>(
        `SELECT codigo, situacao, destino, area, dono_papel_seguranca_id, versao, decidido_em
           FROM triagem_relatorio_legado WHERE estabelecimento_id = ? AND excluido_em IS NULL ORDER BY codigo`,
        [e],
      ),
    );
  const garantir = async (e: Escritor, codigo: string) => {
    const l = await e.uma<{ id: number }>('SELECT id FROM estabelecimento WHERE codigo = ?', [codigo]);
    return l
      ? Number(l.id)
      : e.inserir('INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, NOW(3))', [
          codigo,
          `Hospital de teste ${codigo}`,
          `Hospital de teste ${codigo} (ficticio)`,
        ]);
  };
  const limpar = () =>
    nucleo.escrever({ cliente: CLIENTE, correlacao: 'f22-05-11-limpeza' }, (e) =>
      e.executar('DELETE FROM triagem_relatorio_legado WHERE estabelecimento_id IN (?, ?)', [est, est2]),
    );

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'f22-05-11-preparo' }, async (e) => {
      est = await garantir(e, 'f22o511');
      est2 = await garantir(e, 'f22o511b');
    });
    await limpar();
  });

  afterAll(async () => {
    await limpar();
    await nucleo.encerrar();
  });

  it('inclui proposta com destino (decidida, com área dona) e sem destino (pendente), com trilha', async () => {
    const s = await gravarPropostasTriagem(nucleo.criarExecutor(), CLIENTE, ctx(est), [
      proposta('R1'),
      proposta('R2', { destino: null, marco: null, areaDona: 'bloco' }),
    ]);
    expect(s.resultado).toEqual({ ...vazio, incluidas: 2 });
    const l = await linhas();
    expect(l.map((x) => [x['codigo'], x['situacao'], x['destino'], x['area'], x['dono_papel_seguranca_id'], Number(x['versao'])])).toEqual([
      ['R1', 'proposta', 'catalogo', 'faturamento', null, 1],
      ['R2', 'pendente', null, 'bloco', null, 1],
    ]);
    expect(l[0]?.['decidido_em']).not.toBeNull();
    expect(l[1]?.['decidido_em']).toBeNull();
    const n = await nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'f22-05-11' }, (x) =>
      x.uma<{ n: number }>('SELECT COUNT(*) AS n FROM trilha_auditoria WHERE id = ?', [s.trilha]),
    );
    expect(Number(n?.n)).toBe(1);
  });

  it('preserva a decisão confirmada, atualiza a que mudou (nova versão), não regrava a igual e conta a ausente', async () => {
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'f22-05-11-aceite' }, (e) =>
      e.executar(
        `UPDATE triagem_relatorio_legado SET situacao = 'confirmada', aceito_em = NOW(3), versao = versao + 1
          WHERE estabelecimento_id = ? AND codigo = 'R1'`,
        [est],
      ),
    );
    const s = await gravarPropostasTriagem(nucleo.criarExecutor(), CLIENTE, ctx(est), [
      proposta('R1', { motivo: 'mudou' }),
      proposta('R2', { destino: 'descartado', marco: null }),
      proposta('R3'),
    ]);
    expect(s.resultado).toEqual({ ...vazio, incluidas: 1, atualizadas: 1, preservadas: 1 });
    const s2 = await gravarPropostasTriagem(nucleo.criarExecutor(), CLIENTE, ctx(est), [
      proposta('R2', { destino: 'descartado', marco: null }),
      proposta('R3'),
    ]);
    expect(s2.resultado).toEqual({ ...vazio, inalteradas: 2, ausentes: 1, codigosAusentes: 'R1' });
    const l = await linhas();
    expect(l.map((x) => [x['codigo'], x['situacao'], Number(x['versao'])])).toEqual([
      ['R1', 'confirmada', 2],
      ['R2', 'proposta', 2],
      ['R3', 'proposta', 1],
    ]);
    expect(await resumoTriagemGravada(nucleo, CLIENTE, est)).toEqual({ total: 3, semDono: 0, confirmadas: 1 });
  });

  it('relatório excluído pela área que volta no inventário fica excluído, sem quebrar a chave única', async () => {
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'f22-05-11-exclusao' }, (e) =>
      e.executar(
        `UPDATE triagem_relatorio_legado SET excluido_em = NOW(3), versao = versao + 1
          WHERE estabelecimento_id = ? AND codigo = 'R3'`,
        [est],
      ),
    );
    const s = await gravarPropostasTriagem(nucleo.criarExecutor(), CLIENTE, ctx(est), [
      proposta('R2', { destino: 'descartado', marco: null }),
      proposta('R3', { motivo: 'voltou' }),
    ]);
    expect(s.resultado).toEqual({ ...vazio, inalteradas: 1, excluidasPreservadas: 1, ausentes: 1, codigosAusentes: 'R1' });
    expect((await linhas()).map((x) => x['codigo'])).toEqual(['R1', 'R2']);
  });

  it('grava a proposta do domínio para relatórios de todos os módulos (todas as áreas donas), sem nenhum sem dono', async () => {
    const propostas = MODULOS.map((modulo, i) =>
      propostaDoRelatorio({ id: 500 + i, nome: `Relatorio sintetico ${i}`, modulo, tipo: 2, quantidadeParametros: 0, acessoRestrito: false }),
    );
    const s = await gravarPropostasTriagem(nucleo.criarExecutor(), CLIENTE, ctx(est2), propostas);
    expect(s.resultado.incluidas).toBe(MODULOS.length);
    const l = await linhas(est2);
    expect(l.length).toBe(MODULOS.length);
    for (const x of l) expect(AREAS_TRIAGEM).toContain(x['area']);
    expect(new Set(l.map((x) => x['area']))).toEqual(new Set(propostas.map((p) => p.areaDona)));
    expect((await resumoTriagemGravada(nucleo, CLIENTE, est2)).semDono).toBe(0);
  });

  it('recusa sem estabelecimento na sessão, com entrada inválida e com código repetido, sem gravar', async () => {
    await expect(gravarPropostasTriagem(nucleo.criarExecutor(), CLIENTE, ctx(null), [proposta('R9')])).rejects.toThrow();
    await expect(
      gravarPropostasTriagem(nucleo.criarExecutor(), CLIENTE, ctx(est), [proposta('R9', { marco: 'X9' })]),
    ).rejects.toThrow();
    await expect(
      gravarPropostasTriagem(nucleo.criarExecutor(), CLIENTE, ctx(est), [proposta('R9'), proposta('R9')]),
    ).rejects.toThrow();
    expect((await linhas()).length).toBe(2);
  });
});
