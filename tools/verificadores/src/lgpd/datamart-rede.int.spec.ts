// Integração das ferramentas de leitura contra o MariaDB real (cliente de teste f22_o5; F2.2, lote 05-10): a
// liberação do BI da Rede lida no banco (liberacao_chave e recurso_prerequisito; falha fechada), a carga do data mart
// sobre o núcleo próprio com leituras sintéticas e o arquivo da Rede sem coluna identificadora, o coletor de
// transações do k6, os privilégios da conta da aplicação e os valores de controle da internação. Massa sintética,
// limpa no fim; só contagens no console. SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
// Rodar: ./pnpm exec vitest run --config tools/verificadores/vitest.integracao.config.ts src/lgpd/datamart-rede.int.spec.ts
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { CHAVE_LIBERACAO_BI_REDE, type MovimentoInternacao, recursoDesligado } from '@sgh/contratos';
import { colunasIdentificadoras } from '@sgh/dominio-relatorio/datamart';
import { NucleoProprio, lerConfiguracaoNucleo } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ambienteDoRepositorio, codigosDosEstabelecimentos, nucleoDaCarga } from '../copia-leitura.ts';
import {
  arquivoDaRede,
  biRedeLiberado,
  carregarEstabelecimento,
  consolidarRede,
  type LeiturasDaCarga,
  pseudonimoComumLiberado,
} from '../datamart-carga.ts';
import { valoresDeControle } from '../indicadores-controle-leitura.ts';
import { ambienteDoVigia, coletarTransacoes } from '../k6-coletor.ts';
import { desviosDaConta, lerPrivilegiosDaConta, nomeDaConta } from '../privilegios-banco.ts';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o5';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const raiz = resolve(import.meta.dirname, '../../../..');
const AGORA = Date.UTC(2026, 6, 5, 12);

/** Leituras sintéticas (nenhum dado de pessoa): só agregados. */
const LEITURAS: LeiturasDaCarga = {
  movimento: async () =>
    ({
      internacoes: [],
      trechos: [],
      transferencias: [],
      unidades: [],
      tipos: new Map<number, string>(),
      dadosAte: new Date(AGORA),
    }) as unknown as MovimentoInternacao,
  demografia: async () => new Map(),
  atendimentos: async () => [
    { mes: '2026-06', tipo: 'ambulatorio', convenio: 1, especialidade: 2, quantidade: 7 },
  ],
  itens: async () => [],
  dispensacoes: async () => [{ mes: '2026-06', registros: 3, quantidade: 9 }],
  pessoas: async () => new Map(),
};

describe.skipIf(SEM_BANCO)('ferramentas de leitura contra o MariaDB (cliente f22_o5)', () => {
  let nucleo: NucleoProprio;
  let est: { id: number; codigo: string } | null = null;
  const criados = { chaves: [] as number[], prerequisitos: [] as number[] };
  const pasta = resolve(raiz, `.tmp/int-datamart-05-10-${process.pid}`);

  beforeAll(async () => {
    nucleo = new NucleoProprio({ env: ambienteDoRepositorio() });
    try {
      await nucleo.cliente(CLIENTE);
    } catch {
      execFileSync('python3', ['-I', 'tools/db/criar_cliente.py', CLIENTE, 'Teste F2.2 onda 5'], {
        cwd: raiz,
        stdio: 'ignore',
      });
      nucleo.esquecerCliente(CLIENTE);
    }
    const r = await nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'preparo-05-10' }, (l) =>
      l.consultar<{ id: number | string; codigo: string }>(
        'SELECT id, codigo FROM estabelecimento ORDER BY id LIMIT 1',
      ),
    );
    est = r[0] ? { id: Number(r[0].id), codigo: String(r[0].codigo) } : null;
    mkdirSync(pasta, { recursive: true });
  });

  afterAll(async () => {
    rmSync(pasta, { recursive: true, force: true });
    if (nucleo && (criados.chaves.length || criados.prerequisitos.length))
      await nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-05-10' }, async (e) => {
        for (const id of criados.prerequisitos)
          await e.executar('DELETE FROM recurso_prerequisito WHERE id = ?', [id]);
        for (const id of criados.chaves) await e.executar('DELETE FROM liberacao_chave WHERE id = ?', [id]);
      });
    await nucleo?.encerrar();
  });

  it('estabelecimentos do cliente', async () => {
    expect(est, 'o cliente f22_o5 precisa de um estabelecimento').not.toBeNull();
    expect(await codigosDosEstabelecimentos(nucleo, CLIENTE)).toContain(est!.codigo);
  });

  it('liberação do BI da Rede lida no banco: desligada, ligada com os pré-requisitos, desconhecido = desligado', async () => {
    const e = est!;
    const carga = nucleoDaCarga(nucleo, CLIENTE);
    const existentes = await nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'preparo-05-10' }, (l) =>
      l.consultar(
        "SELECT id FROM liberacao_chave WHERE estabelecimento_id = ? AND tipo = 'recurso' AND chave = ?",
        [e.id, CHAVE_LIBERACAO_BI_REDE],
      ),
    );
    expect(await biRedeLiberado(carga, ['codigo_inexistente'])).toEqual([false]);
    if (existentes.length > 0) return; // estado de outro teste: não mexe
    expect(await biRedeLiberado(carga, [e.codigo])).toEqual([false]);
    const declarados = (recursoDesligado(CHAVE_LIBERACAO_BI_REDE)?.prerequisitos ?? []) as readonly {
      tipo: string;
    }[];
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-05-10' }, async (w) => {
      await w.executar(
        "INSERT INTO liberacao_chave (estabelecimento_id, tipo, chave, escopo, valor, ligada, criado_em) VALUES (?, 'recurso', ?, 'hospital', '*', TRUE, NOW(3))",
        [e.id, CHAVE_LIBERACAO_BI_REDE],
      );
      criados.chaves.push(Number((await w.uma<{ id: number }>('SELECT LAST_INSERT_ID() AS id'))?.id));
      for (const tipo of new Set(declarados.map((p) => p.tipo))) {
        const ja = await w.uma<{ situacao: string }>(
          'SELECT situacao FROM recurso_prerequisito WHERE estabelecimento_id = ? AND recurso = ? AND tipo = ?',
          [e.id, CHAVE_LIBERACAO_BI_REDE, tipo],
        );
        if (ja) continue; // registrado antes (cumprido ou não): a asserção abaixo depende dele, e ele não é apagado
        await w.executar(
          "INSERT INTO recurso_prerequisito (estabelecimento_id, recurso, tipo, situacao, criado_em) VALUES (?, ?, ?, 'cumprido', NOW(3))",
          [e.id, CHAVE_LIBERACAO_BI_REDE, tipo],
        );
        criados.prerequisitos.push(
          Number((await w.uma<{ id: number }>('SELECT LAST_INSERT_ID() AS id'))?.id),
        );
      }
    });
    expect(await biRedeLiberado(carga, [e.codigo])).toEqual([true]);
    // Outro recurso (pseudônimo comum) continua desligado: a chave é por recurso.
    expect(await pseudonimoComumLiberado(carga, [e.codigo])).toEqual([false]);
  });

  it('carga sobre o núcleo próprio e arquivo da Rede sem coluna identificadora', async () => {
    const e = est!;
    const carga = nucleoDaCarga(nucleo, CLIENTE);
    const r = await carregarEstabelecimento(
      carga,
      {
        hospital: e.codigo,
        chave: 'chave-sintetica-05-10',
        modo: 'por-estabelecimento',
        pasta,
        agora: AGORA,
      },
      LEITURAS,
    );
    expect(r).toMatchObject({ internacoes: 0, atendimentos: 1, dispensacoes: 1 });
    const rede = consolidarRede(pasta, [e.codigo], [e.codigo]);
    expect(rede.estabelecimentos).toEqual([e.codigo]);
    const db = new DatabaseSync(arquivoDaRede(pasta), { readOnly: true });
    try {
      const tabelas = (
        db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]
      ).map((t) => ({
        nome: t.name,
        colunas: Object.fromEntries(
          (db.prepare(`PRAGMA table_info(${t.name})`).all() as { name: string }[]).map((c) => [
            c.name,
            'texto' as const,
          ]),
        ),
      }));
      expect(colunasIdentificadoras(tabelas)).toEqual([]);
    } finally {
      db.close();
    }
  });

  it('coletor de transações do k6 vê a transação aberta pelo próprio teste (com a conta do vigia)', async () => {
    const doVigia = ambienteDoVigia(ambienteDoRepositorio());
    if (!doVigia.contaDeMonitoramento) console.log(`coletor: ${doVigia.alertas[0]}`);
    const vigia = new NucleoProprio({ env: doVigia.env });
    try {
      const banco = (await vigia.cliente(CLIENTE)).banco;
      let liberar: () => void = () => undefined;
      const segura = new Promise<void>((r) => (liberar = r));
      let aberta: () => void = () => undefined;
      const abriu = new Promise<void>((r) => (aberta = r));
      // Transação de escrita aberta noutra conexão: trava a linha do estabelecimento e espera a coleta.
      const tx = nucleo.escrever({ cliente: CLIENTE, correlacao: 'k6-transacao-aberta' }, async (w) => {
        await w.consultarParaAtualizar('SELECT id FROM estabelecimento WHERE id = ?', [est!.id]);
        aberta();
        await segura;
      });
      await abriu;
      await new Promise((r) => setTimeout(r, 300));
      let c;
      try {
        c = await vigia.lerSomente({ cliente: CLIENTE, correlacao: 'k6-vigia-teste' }, (l) =>
          coletarTransacoes(l, { banco, limiteTransacaoMs: 5_000 }),
        );
      } finally {
        liberar();
        await tx;
      }
      const comTransacao = c.conexoesDoNovo.filter((x) => x.transacaoMaisLongaMs >= 200);
      expect(
        comTransacao.length,
        'a coleta precisa ver a transação aberta (PROCESS na conta do vigia)',
      ).toBeGreaterThanOrEqual(1);
      expect(c.porProcesso.reduce((s, p) => s + p.travas, 0)).toBeGreaterThanOrEqual(1);
      console.log(
        `coletor: ${c.conexoesDoNovo.length} conexão(ões), ${comTransacao.length} com transação aberta, ${c.alertas.length} alerta(s)`,
      );
    } finally {
      await vigia.encerrar();
    }
  });

  it('privilégios da conta da aplicação lidos do information_schema', async () => {
    const conta = lerConfiguracaoNucleo(ambienteDoRepositorio()).usuario.trim();
    const p = await nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'guardas-teste' }, (l) =>
      lerPrivilegiosDaConta(l),
    );
    expect(p.some((x) => nomeDaConta(x.conta) === conta)).toBe(true);
    const d = desviosDaConta(p, conta);
    console.log(
      `privilégios: ${p.length} linha(s); excesso ${d.excesso.length}; alertas ${d.alertas.length}`,
    );
  });

  it('valores de controle da internação (contagens e chaves sem leitura no modelo)', async () => {
    const r = await valoresDeControle(nucleo, CLIENTE, est!.codigo);
    expect(r.valores['internacoes.2020']).toBeGreaterThanOrEqual(0);
    expect(r.naoMedidos).toContain('receita2025.cobradoDataDoItemMi');
    expect(r.naoMedidos).not.toContain('leitos');
    await expect(valoresDeControle(nucleo, CLIENTE, 'codigo_inexistente')).rejects.toThrow(/não encontrado/);
  });
});
