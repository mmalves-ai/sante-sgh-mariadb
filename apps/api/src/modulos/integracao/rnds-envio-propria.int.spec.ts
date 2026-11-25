// C2-085 (08-INTG L130): contrato de efeito do pedido de envio à Rede Nacional de Dados em Saúde pela API contra o
// MariaDB real (cliente de teste; massa SINTÉTICA com o código do teste, nenhuma pessoa real):
//   - a visão por paciente mostra só o tipo da identificação, o sumário assinado e o resultado liberado com a ação
//     "original"; o rascunho não aparece;
//   - o pedido cria o envio (pendente, perfil fixado quando existe), a versão 1 original com quem pediu e o evento
//     fato.rnds.documento na fila de saída (integracao_mensagem), tudo na mesma transação, com a trilha;
//   - pedir de novo a original, ou substituir antes da aceita, é recusado sem gravar nada;
//   - com a versão aceita, a substituição vira a versão 2 com o motivo (a 1 fica); o motivo curto é recusado;
//   - o paciente sem CPF nem CNS válido é recusado com o motivo.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { PortaRndsEnvioPropria } from './rnds-envio-propria.js';

const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o4';
const P = 'c2085api';
const P2 = 'c2085ap2'; // outro estabelecimento do mesmo cliente (isolamento)
const CPF = '52998224725'; // sintético, dígitos válidos

async function limpar(e: Escritor): Promise<void> {
  const est = '(SELECT id FROM estabelecimento WHERE codigo IN (?, ?))';
  const setores = `(SELECT id FROM setor_diagnostico WHERE estabelecimento_id IN ${est})`;
  await e.executar('SET FOREIGN_KEY_CHECKS = 0');
  try {
    await e.executar(
      `DELETE v FROM envio_rnds_versao v JOIN envio_rnds en ON en.id = v.envio_rnds_id WHERE en.estabelecimento_id IN ${est}`,
      [P, P2],
    );
    await e.executar(`DELETE FROM envio_rnds WHERE estabelecimento_id IN ${est}`, [P, P2]);
    await e.executar(`DELETE FROM integracao_mensagem WHERE estabelecimento_id IN ${est}`, [P, P2]);
    await e.executar(`DELETE FROM sumario_alta WHERE estabelecimento_id IN ${est}`, [P, P2]);
    await e.executar(
      `DELETE ei FROM exame_item ei JOIN resultado_exame r ON r.exame_item_id = ei.id
        WHERE r.setor_diagnostico_id IN ${setores}`,
      [P, P2],
    );
    await e.executar(`DELETE FROM resultado_exame WHERE setor_diagnostico_id IN ${setores}`, [P, P2]);
    await e.executar(`DELETE FROM setor_diagnostico WHERE estabelecimento_id IN ${est}`, [P, P2]);
    await e.executar("DELETE FROM paciente WHERE observacao = 'c2085api'");
    await e.executar("DELETE FROM pessoa_fisica WHERE observacao = 'c2085api'");
    await limparTrilhaDaMassa(e, { codigos: [P, P2] });
    await e.executar('DELETE FROM estabelecimento WHERE codigo IN (?, ?)', [P, P2]);
  } finally {
    await e.executar('SET FOREIGN_KEY_CHECKS = 1');
  }
}

describe.skipIf(SEM_BANCO)('Pedido de envio à RNDS (contrato de efeito)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaRndsEnvioPropria;
  let m: {
    est: number;
    usuario: number;
    paciente: number;
    semId: number;
    sumario: number;
    rascunho: number;
    outro: number;
    resultado: number;
    resultadoOutroEst: number;
    sumarioOutroEst: number;
  };
  const ctx = () => ({ cliente: CLIENTE, usuario: m.usuario, correlacao: P, hospital: P });
  const ler = (sql: string, p: unknown[] = []) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: P }, (l) => l.consultar(sql, p));

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    porta = new PortaRndsEnvioPropria(nucleo, CLIENTE);
    m = await nucleo.escrever({ cliente: CLIENTE, correlacao: `preparo-${P}` }, async (e) => {
      await limpar(e);
      const agora = new Date();
      const est = await e.inserir(
        `INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, fuso_horario, criado_em)
         VALUES (?, 'Hospital Teste', 'Hospital sintético (fictício)', 'America/Sao_Paulo', ?)`,
        [P, agora],
      );
      const est2 = await e.inserir(
        `INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, fuso_horario, criado_em)
         VALUES (?, 'Hospital Teste B', 'Hospital sintético B (fictício)', 'America/Sao_Paulo', ?)`,
        [P2, agora],
      );
      const us = await e.uma('SELECT MIN(id) AS id FROM usuario WHERE excluido_em IS NULL');
      await e.executar('SET FOREIGN_KEY_CHECKS = 0');
      try {
        const pf = await e.inserir(
          "INSERT INTO pessoa_fisica (nome, cpf, observacao, criado_em) VALUES ('Paciente Sintético', ?, 'c2085api', ?)",
          [CPF, agora],
        );
        const pf2 = await e.inserir(
          "INSERT INTO pessoa_fisica (nome, observacao, criado_em) VALUES ('Sem Documento Sintético', 'c2085api', ?)",
          [agora],
        );
        const paciente = await e.inserir(
          "INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, situacao, observacao, criado_em) VALUES (?, 990208511, 'ativo', 'c2085api', ?)",
          [pf, agora],
        );
        const semId = await e.inserir(
          "INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, situacao, observacao, criado_em) VALUES (?, 990208512, 'ativo', 'c2085api', ?)",
          [pf2, agora],
        );
        // Atendimento e profissional reais da base de teste (o envio os referencia); a versão alta não colide com outro sumário.
        const at = await e.uma('SELECT MIN(id) AS id FROM atendimento');
        const prof = await e.uma('SELECT MIN(id) AS id FROM profissional');
        let versao = 90;
        const sumario = async (pac: number, situacao: string, estab = est) =>
          e.inserir(
            `INSERT INTO sumario_alta (estabelecimento_id, atendimento_id, paciente_id, numero_versao, situacao,
               responsavel_profissional_id, registrado_em, situacao_diagnostico, estado_resolucao, obito, finalizado_em,
               criado_em) VALUES (?, ?, ?, ?, ?, ?, ?, 'confirmado', 'melhorado', FALSE, ?, ?)`,
            [
              estab,
              Number(at!['id']),
              pac,
              ++versao,
              situacao,
              Number(prof!['id']),
              agora,
              situacao === 'rascunho' ? null : agora,
              agora,
            ],
          );
        // Resultado liberado no setor de cada estabelecimento: o de B não aparece nem pode ser pedido em A.
        // Um item de pedido próprio por resultado (o resultado é único por item); exame real do catálogo da base.
        const exame = await e.uma('SELECT MIN(id) AS id FROM exame');
        let seq = 0;
        const item = () =>
          e.inserir(
            `INSERT INTO exame_item (requisicao_exame_id, sequencia, exame_id, situacao, liberado_em, criado_em)
             VALUES (0, ?, ?, 'liberado', ?, ?)`,
            [++seq, Number(exame!['id']), agora, agora],
          );
        const setor = (estab: number, codigo: string) =>
          e.inserir(
            `INSERT INTO setor_diagnostico (estabelecimento_id, codigo, nome, tipo, criado_em)
             VALUES (?, ?, 'Laboratório sintético', 'laboratorio', ?)`,
            [estab, codigo, agora],
          );
        const resultado = async (setorId: number) =>
          e.inserir(
            `INSERT INTO resultado_exame (exame_item_id, paciente_id, setor_diagnostico_id, resultado_em, situacao,
               liberado_em, liberado_por_profissional_id, criado_em) VALUES (?, ?, ?, ?, 'liberado', ?, ?, ?)`,
            [await item(), paciente, setorId, agora, agora, Number(prof!['id']), agora],
          );
        return {
          resultado: await resultado(await setor(est, 'c2085a')),
          resultadoOutroEst: await resultado(await setor(est2, 'c2085b')),
          sumarioOutroEst: await sumario(paciente, 'assinado', est2),
          est,
          usuario: Number(us!['id']),
          paciente,
          semId,
          sumario: await sumario(paciente, 'assinado'),
          rascunho: await sumario(paciente, 'rascunho'),
          outro: await sumario(semId, 'assinado'),
        };
      } finally {
        await e.executar('SET FOREIGN_KEY_CHECKS = 1');
      }
    });
  });

  afterAll(async () => {
    await nucleo.escrever({ cliente: CLIENTE, correlacao: `limpeza-${P}` }, (e) => limpar(e));
    await nucleo.encerrar?.();
  });

  it('visão por paciente: só o tipo da identificação; o sumário assinado com a ação original; o rascunho fora', async () => {
    const v = await porta.paciente(ctx(), m.paciente);
    expect(v.identificacao).toBe('cpf');
    expect(JSON.stringify(v)).not.toContain(CPF);
    const sumarios = v.documentos.filter((d) => d.tipo === 'sumario_alta');
    expect(sumarios.map((d) => d.registro)).toEqual([m.sumario]);
    expect(sumarios[0]).toMatchObject({ envio: null, bloqueio: null, acoes: ['original'] });
  });

  it('o pedido grava o envio, a versão 1 com quem pediu e o evento na fila; a original de novo é recusada', async () => {
    const r = await porta.solicitar(ctx(), {
      tipo: 'sumario_alta',
      registro: m.sumario,
      operacao: 'original',
    });
    expect(r).toMatchObject({ versao: 1, tipoVersao: 'original' });
    const [en] = await ler(
      'SELECT tipo_documento, situacao, versao_atual, paciente_id, sumario_alta_id, identificador_local FROM envio_rnds WHERE id = ?',
      [r.id],
    );
    expect(en).toMatchObject({
      tipo_documento: 'sumario_alta',
      situacao: 'pendente',
      versao_atual: 1,
      paciente_id: m.paciente,
      sumario_alta_id: m.sumario,
      identificador_local: `sa-${P}-${m.sumario}`,
    });
    const vs = await ler(
      'SELECT numero_versao, tipo_versao, operacao, situacao, usuario_id FROM envio_rnds_versao WHERE envio_rnds_id = ?',
      [r.id],
    );
    expect(vs).toEqual([
      {
        numero_versao: 1,
        tipo_versao: 'original',
        operacao: 'inclusao',
        situacao: 'pendente',
        usuario_id: m.usuario,
      },
    ]);
    const msg = await ler(
      "SELECT ponto, entidade, entidade_id, referencia_externa FROM integracao_mensagem WHERE estabelecimento_id = ? AND direcao = 'saida'",
      [m.est],
    );
    expect(msg).toEqual([
      {
        ponto: 'fato.rnds.documento',
        entidade: 'envio_rnds',
        entidade_id: r.id,
        referencia_externa: `rnds:${r.id}:v1`,
      },
    ]);
    const trilha = await ler('SELECT COUNT(*) AS n FROM trilha_auditoria WHERE estabelecimento_id = ?', [
      m.est,
    ]);
    expect(Number(trilha[0]!['n'])).toBeGreaterThanOrEqual(1);

    await expect(
      porta.solicitar(ctx(), { tipo: 'sumario_alta', registro: m.sumario, operacao: 'original' }),
    ).rejects.toThrow(/já tem envio/);
    await expect(
      porta.solicitar(ctx(), {
        tipo: 'sumario_alta',
        registro: m.sumario,
        operacao: 'substituicao',
        motivo: 'Correção do diagnóstico principal',
      }),
    ).rejects.toThrow();
    const n = await ler('SELECT COUNT(*) AS n FROM envio_rnds_versao WHERE envio_rnds_id = ?', [r.id]);
    expect(Number(n[0]!['n'])).toBe(1);
  });

  it('com a versão aceita, a substituição é a versão 2 com o motivo; o motivo curto é recusado', async () => {
    const [en] = await ler('SELECT id FROM envio_rnds WHERE identificador_local = ?', [
      `sa-${P}-${m.sumario}`,
    ]);
    const id = Number(en!['id']);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: P }, async (e) => {
      await e.executar("UPDATE envio_rnds_versao SET situacao = 'aceito' WHERE envio_rnds_id = ?", [id]);
      await e.executar("UPDATE envio_rnds SET situacao = 'aceito' WHERE id = ?", [id]);
    });
    await expect(
      porta.solicitar(ctx(), {
        tipo: 'sumario_alta',
        registro: m.sumario,
        operacao: 'substituicao',
        motivo: 'curto',
      }),
    ).rejects.toThrow();
    const r = await porta.solicitar(ctx(), {
      tipo: 'sumario_alta',
      registro: m.sumario,
      operacao: 'substituicao',
      motivo: 'Correção do diagnóstico principal',
    });
    expect(r).toMatchObject({ id, versao: 2, tipoVersao: 'substituicao' });
    const vs = await ler(
      'SELECT numero_versao, tipo_versao, situacao, motivo FROM envio_rnds_versao WHERE envio_rnds_id = ? ORDER BY numero_versao',
      [id],
    );
    expect(vs).toEqual([
      { numero_versao: 1, tipo_versao: 'original', situacao: 'aceito', motivo: null },
      {
        numero_versao: 2,
        tipo_versao: 'substituicao',
        situacao: 'pendente',
        motivo: 'Correção do diagnóstico principal',
      },
    ]);
    const versoes = await porta.versoes(ctx(), id);
    expect(versoes.map((v) => v.numero)).toEqual([1, 2]);
    const monitor = await porta.envios(ctx(), { paciente: m.paciente, situacao: null });
    expect(monitor[0]).toMatchObject({
      id,
      versaoAtual: 2,
      situacao: 'pendente',
      situacaoVersao: 'pendente',
    });
  });

  it('o paciente sem CPF nem CNS válido é recusado com o motivo', async () => {
    const v = await porta.paciente(ctx(), m.semId);
    expect(v.identificacao).toBe('nenhuma');
    expect(v.documentos[0]).toMatchObject({ acoes: [] });
    expect(v.documentos[0]!.bloqueio).toMatch(/CPF válido nem CNS/);
    await expect(
      porta.solicitar(ctx(), { tipo: 'sumario_alta', registro: m.outro, operacao: 'original' }),
    ).rejects.toThrow();
  });

  it('isolamento: resultado e sumário de outro estabelecimento não aparecem e o pedido é 404 sem gravar', async () => {
    const v = await porta.paciente(ctx(), m.paciente);
    const resultados = v.documentos.filter((d) => d.tipo === 'resultado_exame').map((d) => d.registro);
    expect(resultados).toContain(m.resultado);
    expect(resultados).not.toContain(m.resultadoOutroEst);
    expect(v.documentos.map((d) => d.registro)).not.toContain(m.sumarioOutroEst);
    const ests = '(SELECT id FROM estabelecimento WHERE codigo IN (?, ?))';
    const contar = async () => {
      const [x] = await ler(
        `SELECT (SELECT COUNT(*) FROM envio_rnds WHERE estabelecimento_id IN ${ests}) AS e,
           (SELECT COUNT(*) FROM envio_rnds_versao v JOIN envio_rnds en ON en.id = v.envio_rnds_id
             WHERE en.estabelecimento_id IN ${ests}) AS v,
           (SELECT COUNT(*) FROM integracao_mensagem WHERE estabelecimento_id IN ${ests}) AS i`,
        [P, P2, P, P2, P, P2],
      );
      return [Number(x!['e']), Number(x!['v']), Number(x!['i'])];
    };
    const antes = await contar();
    for (const pedido of [
      { tipo: 'resultado_exame' as const, registro: m.resultadoOutroEst, operacao: 'original' as const },
      {
        tipo: 'resultado_exame' as const,
        registro: m.resultadoOutroEst,
        operacao: 'cancelamento' as const,
        motivo: 'Pedido indevido de outro hospital',
      },
      { tipo: 'sumario_alta' as const, registro: m.sumarioOutroEst, operacao: 'original' as const },
    ])
      await expect(porta.solicitar(ctx(), pedido)).rejects.toMatchObject({ problema: { status: 404 } });
    expect(await contar()).toEqual(antes);
  });
});
