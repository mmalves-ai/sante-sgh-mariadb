// Integração dos valores de controle da internação e do isolamento da carga do data mart contra o MariaDB real
// (cliente de teste f22_o5; F2.2, lote 05-10, achados da revisão). Massa SINTÉTICA com códigos "V0510" (nenhuma
// pessoa real): dois estabelecimentos; no primeiro, uma internação ativa (com transferência e dois trechos), uma com
// alta e uma cancelada, e dois leitos (um inativo); no segundo, uma internação ativa. Limpa no começo e no fim; os
// cadastros do cliente (caráter, modalidade, motivos) são garantidos por código e ficam. SGH_NUCLEO_SEM_BANCO=1 pula.
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { MovimentoInternacao } from '@sgh/contratos';
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ambienteDoRepositorio, nucleoDaCarga } from './copia-leitura.ts';
import { arquivoDoEstabelecimento, carregarEstabelecimento, type LeiturasDaCarga } from './datamart-carga.ts';
import { valoresDeControle } from './indicadores-controle-leitura.ts';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o5';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const raiz = resolve(import.meta.dirname, '../../..');
const P = 'V0510';
const A = `${P}A`;
const B = `${P}B`;

async function garantir(e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]): Promise<number> {
  const l = await e.uma<{ id: number }>(sel, p);
  return l ? Number(l.id) : e.inserir(ins, pi);
}

async function limpar(e: Escritor, ests: readonly number[]): Promise<void> {
  if (ests.length === 0) return;
  const em = ests.map(() => '?').join(', ');
  await e.executar(`DELETE FROM transferencia_leito WHERE estabelecimento_id IN (${em})`, ests);
  await e.executar(
    `UPDATE ocupacao_leito SET anterior_ocupacao_leito_id = NULL WHERE estabelecimento_id IN (${em})`,
    ests,
  );
  await e.executar(`DELETE FROM ocupacao_leito WHERE estabelecimento_id IN (${em})`, ests);
  await e.executar(`DELETE FROM internacao WHERE estabelecimento_id IN (${em})`, ests);
  await e.executar(`DELETE FROM atendimento WHERE estabelecimento_id IN (${em})`, ests);
  await e.executar(`DELETE FROM leito_hospitalar WHERE estabelecimento_id IN (${em})`, ests);
  await e.executar(`DELETE FROM acomodacao WHERE estabelecimento_id IN (${em})`, ests);
  await e.executar(`DELETE FROM bloco_internacao WHERE estabelecimento_id IN (${em})`, ests);
  await e.executar(`DELETE FROM unidade_internacao WHERE estabelecimento_id IN (${em})`, ests);
  await e.executar(`DELETE FROM unidade_assistencial WHERE estabelecimento_id IN (${em})`, ests);
}

describe.skipIf(SEM_BANCO)('valores de controle e isolamento da carga (cliente f22_o5, massa V0510)', () => {
  let nucleo: NucleoProprio;
  const ests: number[] = [];
  const pasta = resolve(raiz, `.tmp/int-controle-05-10-${process.pid}`);

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
    mkdirSync(pasta, { recursive: true });
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-05-10-controle' }, async (e) => {
      const agora = new Date();
      const g = (sel: string, p: unknown[], ins: string, pi: unknown[]) => garantir(e, sel, p, ins, pi);
      const cad = (tabela: string, codigo: string, colunas: Record<string, unknown>) => {
        if (!/^[a-z_]+$/.test(tabela) || !Object.keys(colunas).every((k) => /^[a-z_]+$/.test(k)))
          throw new Error('nome inválido');
        const ks = Object.keys(colunas);
        return g(
          `SELECT id FROM ${tabela} WHERE codigo = ?`,
          [codigo],
          `INSERT INTO ${tabela} (codigo, ${ks.join(', ')}, criado_em) VALUES (?, ${ks.map(() => '?').join(', ')}, ?)`,
          [codigo, ...ks.map((k) => colunas[k]), agora],
        );
      };
      const estab = (cod: string) =>
        g(
          'SELECT id FROM estabelecimento WHERE codigo = ?',
          [cod],
          'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
          [cod, 'ESTAB SINTETICO CONTROLE', 'ESTAB SINTETICO CONTROLE', agora],
        );
      const estA = await estab(A);
      const estB = await estab(B);
      ests.push(estA, estB);
      await limpar(e, ests);
      const login = 'v0510.teste';
      const usuario = await g(
        'SELECT id FROM usuario WHERE login = ?',
        [login],
        "INSERT INTO usuario (login, nome, tipo_conta, criado_em) VALUES (?, ?, 'servico', ?)",
        [login, `USUARIO SINTETICO ${P}`, agora],
      );
      const livre = await cad('situacao_leito', `${P}-livre`, {
        descricao: `LIVRE ${P}`,
        situacao_base: 'livre',
        permite_ocupacao: true,
      });
      const catAc = await cad('categoria_acomodacao', `${P}-ENF`, {
        descricao: `ENFERMARIA ${P}`,
        tipo: 'enfermaria',
      });
      const mapa = async (est: number) => {
        const ua = await e.inserir(
          "INSERT INTO unidade_assistencial (estabelecimento_id, codigo, nome, tipo_unidade, criado_em) VALUES (?, 'UA1', 'INTERNACAO SINTETICA', 'internacao', ?)",
          [est, agora],
        );
        const ui = await e.inserir(
          "INSERT INTO unidade_internacao (estabelecimento_id, unidade_assistencial_id, codigo, descricao, tipo, criado_em) VALUES (?, ?, 'UI1', 'ENFERMARIA SINTETICA', 'enfermaria', ?)",
          [est, ua, agora],
        );
        const bloco = await e.inserir(
          "INSERT INTO bloco_internacao (estabelecimento_id, codigo, nome, criado_em) VALUES (?, 'B1', 'BLOCO SINTETICO', ?)",
          [est, agora],
        );
        const ac = await e.inserir(
          "INSERT INTO acomodacao (estabelecimento_id, bloco_internacao_id, unidade_internacao_id, categoria_acomodacao_id, codigo, nome, quantidade_leitos, criado_em) VALUES (?, ?, ?, ?, 'Q1', 'QUARTO 1', 2, ?)",
          [est, bloco, ui, catAc, agora],
        );
        const leito = (cod: string, ativo: boolean) =>
          e.inserir(
            'INSERT INTO leito_hospitalar (estabelecimento_id, unidade_internacao_id, acomodacao_id, bloco_internacao_id, codigo, situacao_leito_id, ativo, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [est, ui, ac, bloco, cod, livre, ativo, agora],
          );
        return { ui, ac, l1: await leito('01', true), l2: await leito('02', est === estA ? false : true) };
      };
      const mA = await mapa(estA);
      const mB = await mapa(estB);
      const pessoa = (nome: string) =>
        g(
          'SELECT id FROM pessoa_fisica WHERE nome = ?',
          [nome],
          'INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, ?)',
          [nome, agora],
        );
      const pac = async (k: number) => {
        const pf = await pessoa(`PACIENTE SINTETICO ${P} ${k}`);
        return g(
          'SELECT id FROM paciente WHERE pessoa_fisica_id = ?',
          [pf],
          "INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, situacao, criado_em) VALUES (?, ?, 'ativo', ?)",
          [pf, 951_000 + k, agora],
        );
      };
      const pm = await pessoa(`MEDICO SINTETICO ${P}`);
      const medico = await g(
        'SELECT id FROM profissional WHERE pessoa_fisica_id = ?',
        [pm],
        "INSERT INTO profissional (pessoa_fisica_id, tipo, criado_em) VALUES (?, 'corpo_clinico', ?)",
        [pm, agora],
      );
      const convenio = await g(
        'SELECT id FROM fonte_pagadora WHERE codigo = ?',
        [P],
        "INSERT INTO fonte_pagadora (codigo, nome, tipo, situacao, criado_em) VALUES (?, ?, 'operadora', 'ativa', ?)",
        [P, `OPERADORA ${P}`, agora],
      );
      const tiss = await g(
        'SELECT id FROM carater_atendimento_tiss WHERE codigo_tiss = ?',
        ['Y5'],
        "INSERT INTO carater_atendimento_tiss (codigo_tiss, descricao, versao_fonte, urgencia, criado_em) VALUES ('Y5', ?, 'teste', TRUE, ?)",
        [`URGENCIA ${P}`, agora],
      );
      const categoria = await cad('categoria_atendimento', `${P}-INT`, {
        descricao: `INTERNACAO ${P}`,
        tipo_base: 'internacao',
      });
      const urgente = await cad('carater_admissao', `${P}-URG`, {
        descricao: `URGENCIA ${P}`,
        urgencia: true,
      });
      const eletiva = await cad('carater_admissao', `${P}-ELE`, {
        descricao: `ELETIVA ${P}`,
        urgencia: false,
      });
      const clinica = await cad('modalidade_internacao', `${P}-CLI`, {
        descricao: `CLINICA ${P}`,
        classificacao: 'clinica',
      });
      const cirurgica = await cad('modalidade_internacao', `${P}-CIR`, {
        descricao: `CIRURGICA ${P}`,
        classificacao: 'cirurgica',
      });
      const especialidade = await cad('especialidade_medica', `${P}-CLM`, {
        descricao: `CLINICA MEDICA ${P}`,
      });
      const desfecho = await cad('desfecho_internacao', `${P}-ALTA`, { descricao: `ALTA ${P}` });
      const motivoAlta = await cad('motivo_saida_hospitalar', `${P}-ALTA`, {
        descricao: `ALTA MELHORADO ${P}`,
        tipo_saida: 'alta',
        desfecho_internacao_id: desfecho,
      });
      const motivoCanc = await cad('motivo_cancelamento_internacao', `${P}-ERRO`, {
        descricao: `INTERNACAO POR ENGANO ${P}`,
      });
      const motivoTroca = await cad('motivo_troca_leito', `${P}-CONF`, {
        descricao: `CONFORTO ${P}`,
        aplica_a: 'internacao',
      });
      let num = 0;
      const internar = async (
        est: number,
        m: { ui: number; ac: number },
        o: {
          pac: number;
          entrada: string;
          carater: number;
          modalidade: number;
          situacao: string;
          alta?: string;
          cancelada?: string;
        },
      ) => {
        num++;
        const at = await e.inserir(
          'INSERT INTO atendimento (estabelecimento_id, numero, paciente_id, categoria_atendimento_id, carater_atendimento_tiss_id, fonte_pagadora_id, profissional_id, entrada_em, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [est, `${P}-${num}`, o.pac, categoria, tiss, convenio, medico, o.entrada, agora],
        );
        return e.inserir(
          `INSERT INTO internacao (estabelecimento_id, numero, atendimento_id, paciente_id, data_hora_entrada, carater_admissao_id,
             modalidade_internacao_id, unidade_internacao_id, acomodacao_id, especialidade_medica_id, medico_assistente_profissional_id,
             fonte_pagadora_id, situacao, data_hora_alta, motivo_saida_hospitalar_id, data_hora_cancelamento, motivo_cancelamento_internacao_id, criado_em)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            est,
            `${P}-${num}`,
            at,
            o.pac,
            o.entrada,
            o.carater,
            o.modalidade,
            m.ui,
            m.ac,
            especialidade,
            medico,
            convenio,
            o.situacao,
            o.alta ?? null,
            o.alta ? motivoAlta : null,
            o.cancelada ?? null,
            o.cancelada ? motivoCanc : null,
            agora,
          ],
        );
      };
      const ocupar = (
        est: number,
        int: number,
        leito: number,
        m: { ui: number; ac: number },
        ini: string,
        fim: string | null,
        sit: string,
      ) =>
        e.inserir(
          'INSERT INTO ocupacao_leito (estabelecimento_id, internacao_id, leito_hospitalar_id, unidade_internacao_id, acomodacao_id, data_hora_inicio, data_hora_fim, situacao, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [est, int, leito, m.ui, m.ac, ini, fim, sit, agora],
        );
      // Estabelecimento A: ativa (urgência, clínica) com transferência; alta (eletiva, cirúrgica); cancelada.
      const ativa = await internar(estA, mA, {
        pac: await pac(1),
        entrada: '2024-03-01 10:00:00',
        carater: urgente,
        modalidade: clinica,
        situacao: 'ativa',
      });
      await ocupar(estA, ativa, mA.l2, mA, '2024-03-01 10:00:00', '2024-03-01 18:00:00', 'encerrada');
      await ocupar(estA, ativa, mA.l1, mA, '2024-03-01 18:00:00', null, 'ativa');
      await e.inserir(
        "INSERT INTO transferencia_leito (estabelecimento_id, internacao_id, origem_leito_hospitalar_id, destino_leito_hospitalar_id, motivo_troca_leito_id, transferido_em, executado_por_usuario_id, situacao, criado_em) VALUES (?, ?, ?, ?, ?, '2024-03-01 18:00:00', ?, 'efetivada', ?)",
        [estA, ativa, mA.l2, mA.l1, motivoTroca, usuario, agora],
      );
      const alta = await internar(estA, mA, {
        pac: await pac(2),
        entrada: '2024-02-01 08:00:00',
        carater: eletiva,
        modalidade: cirurgica,
        situacao: 'alta',
        alta: '2024-02-10 12:00:00',
      });
      await ocupar(estA, alta, mA.l1, mA, '2024-02-01 08:00:00', '2024-02-10 12:00:00', 'encerrada');
      await internar(estA, mA, {
        pac: await pac(3),
        entrada: '2024-03-02 09:00:00',
        carater: urgente,
        modalidade: clinica,
        situacao: 'cancelada',
        cancelada: '2024-03-02 10:00:00',
      });
      // Estabelecimento B: uma ativa (não pode aparecer nas contagens de A).
      await internar(estB, mB, {
        pac: await pac(4),
        entrada: '2024-03-05 07:00:00',
        carater: urgente,
        modalidade: clinica,
        situacao: 'ativa',
      });
    });
  });

  afterAll(async () => {
    rmSync(pasta, { recursive: true, force: true });
    if (nucleo && ests.length)
      await nucleo
        .escrever({ cliente: CLIENTE, correlacao: 'limpeza-05-10-controle' }, (e) => limpar(e, ests))
        .catch(() => undefined);
    await nucleo?.encerrar();
  });

  it('conta só as internações válidas do estabelecimento (cancelada e outro estabelecimento fora)', async () => {
    const r = await valoresDeControle(nucleo, CLIENTE, A);
    expect(r.dadosAte).toBe('2024-03-01');
    expect(r.valores).toMatchObject({
      'internacoes.2024': 2,
      internadosNoFim: 1,
      'carater.urgencia': 1,
      'carater.eletiva': 1,
      'clinica.medica': 1,
      'clinica.cirurgica': 1,
      'motivo.melhorado': 1,
      'motivo.obito': 0,
      leitos: 2,
      leitosAtivos: 1,
      transferencias: 1,
      trechos: 3,
    });
    const b = await valoresDeControle(nucleo, CLIENTE, B);
    expect(b.valores).toMatchObject({
      'internacoes.2024': 1,
      internadosNoFim: 1,
      leitos: 2,
      leitosAtivos: 2,
      transferencias: 0,
      trechos: 0,
    });
  });

  it('naoMedidos fica só com a receita e a saída para internação domiciliar', async () => {
    const r = await valoresDeControle(nucleo, CLIENTE, A);
    expect([...r.naoMedidos].sort()).toEqual([
      'motivo.internacaoDomiciliar',
      'receita2025.cobradoCompetenciaMi',
      'receita2025.cobradoDataDoItemMi',
      'receita2025.pagoCompetenciaMi',
      'receita2025.pagoDataDoItemMi',
    ]);
  });

  it('a carga do data mart entrega a cada estabelecimento o seu id (isolamento entre estabelecimentos do cliente)', async () => {
    // Leituras sintéticas que leem o banco PELO id recebido: o arquivo de cada estabelecimento leva só as suas.
    const vistos: number[] = [];
    const leituras: LeiturasDaCarga = {
      movimento: async () =>
        ({
          internacoes: [],
          trechos: [],
          transferencias: [],
          unidades: [],
          tipos: new Map(),
          dadosAte: new Date(Date.UTC(2024, 2, 6)),
        }) as unknown as MovimentoInternacao,
      demografia: async () => new Map(),
      atendimentos: async () => [],
      itens: async () => [],
      dispensacoes: async (l, est) => {
        vistos.push(est);
        const x = await l.uma<{ n: number | string }>(
          "SELECT COUNT(*) AS n FROM internacao WHERE estabelecimento_id = ? AND excluido_em IS NULL AND situacao <> 'cancelada'",
          [est],
        );
        return [{ mes: '2024-03', registros: Number(x?.n ?? 0), quantidade: est }];
      },
      pessoas: async () => new Map(),
    };
    const carga = nucleoDaCarga(nucleo, CLIENTE);
    for (const cod of [A, B])
      await carregarEstabelecimento(
        carga,
        {
          hospital: cod,
          chave: 'chave-sintetica-05-10',
          modo: 'por-estabelecimento',
          pasta,
          agora: Date.UTC(2024, 2, 6),
        },
        leituras,
      );
    expect(vistos).toEqual(ests);
    for (const [cod, est, registros] of [
      [A, ests[0], 2],
      [B, ests[1], 1],
    ] as const) {
      const db = new DatabaseSync(arquivoDoEstabelecimento(pasta, cod), { readOnly: true });
      try {
        const linhas = db
          .prepare('SELECT estabelecimento, registros, quantidade FROM fato_dispensacao')
          .all() as { estabelecimento: string; registros: number; quantidade: number }[];
        expect(linhas).toEqual([{ estabelecimento: cod, registros, quantidade: est }]);
      } finally {
        db.close();
      }
    }
    await expect(
      carregarEstabelecimento(
        carga,
        { hospital: 'codigo_inexistente', chave: 'x', modo: 'por-estabelecimento', pasta },
        leituras,
      ),
    ).rejects.toThrow(/não encontrado/);
  });
});
