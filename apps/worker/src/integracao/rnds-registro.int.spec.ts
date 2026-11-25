// C2-085 (08-INTG L130): contrato de efeito do envio à Rede Nacional de Dados em Saúde pelo worker contra o MariaDB
// real (cliente de teste; massa SINTÉTICA com o código do teste, nenhuma pessoa real) e um simulador HTTP local:
//   - o sumário de alta pendente vai ao simulador com o paciente pelo CPF, e a versão 1 fica aceita com o identificador
//     nacional, o envio aceito, o perfil fixado e o CNS do paciente guardado em identificador_externo_pessoa;
//   - a recusa (422) do resultado de exame fica na versão e no envio (rejeitado, código e motivo) e volta como erro de
//     entrega; a falha de transporte fica como erro;
//   - o RIA da vacina grava o envio e a versão pelo mesmo caminho (versão do evento 0 → versão 1 original);
//   - a substituição vira a versão 2 (substituicao) do mesmo envio, sem apagar a 1.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../teste/limpar-trilha.spec-util.js';
import { type AcessoIntegracao, acessoDoNucleo } from './acesso.js';
import type { ConfiguracaoEnviadores } from './enviadores.js';
import type { EnvioEntrega } from './porta-propria.js';
import {
  dadosEnvioVacina,
  enviarDocumentoRnds,
  garantirEnvioRnds,
  OPERACAO_REGISTRO_RNDS,
  postarERegistrar,
  TABELAS_REGISTRO_RNDS,
} from './rnds-registro.js';

const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o4';
const P = 'c2085wk';
const CPF = '52998224725'; // sintético, dígitos válidos
const CNS = '898001160629007'; // CNS provisório sintético (soma ponderada múltipla de 11)

async function limpar(e: Escritor): Promise<void> {
  const est = '(SELECT id FROM estabelecimento WHERE codigo = ?)';
  await e.executar('SET FOREIGN_KEY_CHECKS = 0');
  try {
    await e.executar(
      `DELETE v FROM envio_rnds_versao v JOIN envio_rnds en ON en.id = v.envio_rnds_id WHERE en.estabelecimento_id IN ${est}`,
      [P],
    );
    await e.executar(`DELETE FROM envio_rnds WHERE estabelecimento_id IN ${est}`, [P]);
    await e.executar('DELETE FROM identificador_externo_pessoa WHERE identificador = ?', [CNS]);
    await e.executar(`DELETE FROM sumario_alta WHERE estabelecimento_id IN ${est}`, [P]);
    await e.executar("DELETE FROM resultado_exame WHERE observacao = 'c2085wk'");
    await e.executar(
      "DELETE ei FROM exame_item ei JOIN exame ex ON ex.id = ei.exame_id WHERE ex.codigo = 'C2085WK'",
    );
    await e.executar("DELETE FROM exame WHERE codigo = 'C2085WK'");
    await e.executar("DELETE FROM paciente WHERE observacao = 'c2085wk'");
    await e.executar("DELETE FROM pessoa_fisica WHERE observacao = 'c2085wk'");
    await limparTrilhaDaMassa(e, { codigos: [P] });
    await e.executar('DELETE FROM estabelecimento WHERE codigo = ?', [P]);
  } finally {
    await e.executar('SET FOREIGN_KEY_CHECKS = 1');
  }
}

describe.skipIf(SEM_BANCO)('Envio à RNDS pelo worker (contrato de efeito)', () => {
  let nucleo: NucleoProprio;
  let acesso: AcessoIntegracao;
  let servidor: Server;
  let url = '';
  let proximo = { status: 201, corpo: '{}', location: 'Bundle/rnds-sint-1' as string | null };
  const recebidos: Record<string, unknown>[] = [];
  let m: { est: number; paciente: number; sumario: number; resultado: number };
  const ler = (sql: string, p: unknown[] = []) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: P }, (l) => l.consultar(sql, p));
  const config = (): ConfiguracaoEnviadores =>
    ({
      ambiente: 'desenvolvimento',
      produto: 'sgh',
      hostMllp: '127.0.0.1',
      simuladorRnds: url,
      destinoApi: () => null,
      ler: (h, fn) => acesso.ler(h, fn),
      gravar: (h, fn, o) => acesso.gravar(h, fn, o),
      agora: () => new Date(),
    }) as ConfiguracaoEnviadores;
  const preparar = (tipo: 'sumario_alta' | 'resultado_exame', registro: number, numero = 1) =>
    acesso.gravar(
      P,
      (tx) =>
        garantirEnvioRnds(
          tx,
          {
            hospital: P,
            tipo,
            registro,
            paciente: m.paciente,
            atendimento: null,
            profissional: null,
            numero,
            tipoVersao: numero === 1 ? 'original' : 'substituicao',
          },
          new Date(),
        ),
      { operacao: OPERACAO_REGISTRO_RNDS, tabelas: TABELAS_REGISTRO_RNDS },
    );
  const evento = (envio: number) =>
    ({ id: '1', objeto: String(envio), tipoEvento: 'fato.rnds.documento' }) as EnvioEntrega;

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    servidor = createServer((req, res) => {
      let corpo = '';
      req.on('data', (d: Buffer) => (corpo += d.toString()));
      req.on('end', () => {
        recebidos.push(JSON.parse(corpo) as Record<string, unknown>);
        res.writeHead(proximo.status, proximo.location ? { location: proximo.location } : {});
        res.end(proximo.corpo);
      });
    });
    await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
    url = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}/fhir/Bundle`;
    m = await nucleo.escrever({ cliente: CLIENTE, correlacao: `preparo-${P}` }, async (e) => {
      await limpar(e);
      const agora = new Date();
      const est = await e.inserir(
        `INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, fuso_horario, criado_em)
         VALUES (?, 'Hospital Teste', 'Hospital sintético (fictício)', 'America/Sao_Paulo', ?)`,
        [P, agora],
      );
      await e.executar('SET FOREIGN_KEY_CHECKS = 0');
      try {
        const pessoa = await e.inserir(
          "INSERT INTO pessoa_fisica (nome, cpf, cns, observacao, criado_em) VALUES ('Paciente Sintético', ?, ?, 'c2085wk', ?)",
          [CPF, CNS, agora],
        );
        const paciente = await e.inserir(
          `INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, cadastro_estabelecimento_id, situacao, observacao, criado_em)
           VALUES (?, 990208501, ?, 'ativo', 'c2085wk', ?)`,
          [pessoa, est, agora],
        );
        const sumario = await e.inserir(
          `INSERT INTO sumario_alta (estabelecimento_id, atendimento_id, paciente_id, numero_versao, situacao,
             responsavel_profissional_id, registrado_em, alta_medica_em, codigo_cid10_principal, situacao_diagnostico,
             estado_resolucao, obito, motivo_internacao, condicao_alta, finalizado_em, criado_em)
           VALUES (?, 999999, ?, 1, 'assinado', 999999, ?, ?, 'J18.9', 'confirmado', 'melhorado', FALSE,
             'Motivo sintético', 'Melhorado', ?, ?)`,
          [est, paciente, agora, agora, agora, agora],
        );
        const exame = await e.inserir(
          "INSERT INTO exame (codigo, sigla, nome, tipo_servico, criado_em) VALUES ('C2085WK', 'C2085', 'Exame sintético', 'laboratorio', ?)",
          [agora],
        );
        const item = await e
          .inserir(
            `INSERT INTO exame_item (requisicao_exame_id, sequencia, exame_id, situacao, criado_em)
           VALUES (990208599, 1, ?, 'liberado', ?)`,
            [exame, agora],
          )
          .catch(async () =>
            e.inserir(
              `INSERT INTO exame_item (requisicao_exame_id, sequencia, exame_id, situacao, liberado_em, criado_em)
             VALUES (990208599, 1, ?, 'liberado', ?, ?)`,
              [exame, agora, agora],
            ),
          );
        const resultado = await e.inserir(
          `INSERT INTO resultado_exame (exame_item_id, paciente_id, setor_diagnostico_id, resultado_em, forma_entrada, situacao, numero_versao, liberado_em,
             autoliberado, anormal, conclusao, observacao, criado_em)
           VALUES (?, ?, 999999, ?, 'digitado', 'liberado', 1, ?, TRUE, FALSE, 'Conclusão sintética', 'c2085wk', ?)`,
          [item, paciente, agora, agora, agora],
        );
        return { est, paciente, sumario, resultado };
      } finally {
        await e.executar('SET FOREIGN_KEY_CHECKS = 1');
      }
    });
    acesso = acessoDoNucleo(nucleo, CLIENTE, P);
  });

  afterAll(async () => {
    await nucleo.escrever({ cliente: CLIENTE, correlacao: `limpeza-${P}` }, (e) => limpar(e));
    await new Promise((ok) => servidor.close(ok));
    await nucleo.encerrar?.();
  });

  it('sumário aceito: versão 1 aceita com o identificador nacional, perfil fixado e CNS guardado', async () => {
    const envio = await preparar('sumario_alta', m.sumario);
    proximo = { status: 201, corpo: '{}', location: 'Bundle/rnds-sint-1' };
    const r = await enviarDocumentoRnds(config(), evento(envio), P);
    expect(r.resposta).toMatch(/^HTTP 201/);
    const doc = recebidos.at(-1)!;
    expect(doc).toMatchObject({ type: 'document', identifier: { value: `sa-${P}-${m.sumario}-v1` } });
    expect(JSON.stringify(doc)).toContain(CPF);
    const [en] = await ler(
      `SELECT en.situacao, en.versao_atual, en.tentativas, en.identificador_nacional, en.aceito_em IS NOT NULL AS aceito,
              p.codigo AS perfil, p.versao_perfil
         FROM envio_rnds en JOIN perfil_fhir p ON p.id = en.perfil_fhir_id WHERE en.id = ?`,
      [envio],
    );
    expect(en).toMatchObject({
      situacao: 'aceito',
      versao_atual: 1,
      tentativas: 1,
      perfil: 'br-core-composition',
    });
    expect(en!['identificador_nacional']).toBeTruthy();
    const vs = await ler(
      'SELECT numero_versao, tipo_versao, operacao, situacao, codigo_retorno FROM envio_rnds_versao WHERE envio_rnds_id = ?',
      [envio],
    );
    expect(vs).toEqual([
      {
        numero_versao: 1,
        tipo_versao: 'original',
        operacao: 'inclusao',
        situacao: 'aceito',
        codigo_retorno: 'HTTP 201',
      },
    ]);
    const ids = await ler(
      `SELECT i.tipo_identificador, i.principal, s.codigo FROM identificador_externo_pessoa i
         JOIN sistema_externo s ON s.id = i.sistema_externo_id WHERE i.identificador = ?`,
      [CNS],
    );
    expect(ids).toHaveLength(1);
    expect(ids[0]).toMatchObject({ tipo_identificador: 'cns_provisorio', codigo: 'rnds' });
    const perfis = await ler(
      "SELECT COUNT(*) AS n FROM perfil_fhir WHERE codigo LIKE 'br-core-%' AND fixado_em IS NOT NULL",
    );
    expect(Number(perfis[0]!['n'])).toBeGreaterThanOrEqual(8);

    // A substituição é a versão 2 do mesmo envio; a 1 continua lá.
    const mesmo = await preparar('sumario_alta', m.sumario, 2);
    expect(mesmo).toBe(envio);
    await enviarDocumentoRnds(config(), evento(envio), P);
    const doc2 = recebidos.at(-1)!;
    expect(JSON.stringify(doc2)).toContain(`sa-${P}-${m.sumario}-v1`); // relatesTo replaces
    const vs2 = await ler(
      'SELECT numero_versao, tipo_versao, situacao FROM envio_rnds_versao WHERE envio_rnds_id = ? ORDER BY numero_versao',
      [envio],
    );
    expect(vs2).toEqual([
      { numero_versao: 1, tipo_versao: 'original', situacao: 'aceito' },
      { numero_versao: 2, tipo_versao: 'substituicao', situacao: 'aceito' },
    ]);
  });

  it('resultado recusado (422) fica rejeitado com o motivo; a falha de transporte fica como erro', async () => {
    const envio = await preparar('resultado_exame', m.resultado);
    proximo = { status: 422, corpo: '{"issue":[{"diagnostics":"perfil inválido"}]}', location: null };
    await expect(enviarDocumentoRnds(config(), evento(envio), P)).rejects.toThrow();
    const [en] = await ler(
      'SELECT situacao, tentativas, codigo_erro, mensagem_erro IS NOT NULL AS tem_motivo FROM envio_rnds WHERE id = ?',
      [envio],
    );
    expect(en).toMatchObject({ situacao: 'rejeitado', tentativas: 1, codigo_erro: 'HTTP 422' });
    expect(Number(en!['tem_motivo'])).toBe(1);
    const [v] = await ler('SELECT situacao, codigo_retorno FROM envio_rnds_versao WHERE envio_rnds_id = ?', [
      envio,
    ]);
    expect(v).toMatchObject({ situacao: 'rejeitado', codigo_retorno: 'HTTP 422' });

    const fora = { ...config(), simuladorRnds: 'http://127.0.0.1:1/fhir' } as ConfiguracaoEnviadores;
    await expect(enviarDocumentoRnds(fora, evento(envio), P)).rejects.toThrow(/indisponível/);
    const [en2] = await ler('SELECT situacao, tentativas, codigo_erro FROM envio_rnds WHERE id = ?', [envio]);
    expect(en2).toMatchObject({ situacao: 'erro', tentativas: 2, codigo_erro: 'transporte' });
  });

  it('o RIA da vacina grava o envio e a versão 1 original pelo mesmo caminho', async () => {
    proximo = { status: 201, corpo: '{}', location: 'Bundle/rnds-sint-ria' };
    const vacina = 990208502;
    // A vacina não existe na massa (FK suspensa só para o envio ficar ligado a um id sintético).
    const envio = await nucleo.escrever({ cliente: CLIENTE, correlacao: P }, async (e) => {
      await e.executar('SET FOREIGN_KEY_CHECKS = 0');
      try {
        return await e.inserir(
          `INSERT INTO envio_rnds (estabelecimento_id, paciente_id, vacina_aplicada_id, tipo_documento,
             identificador_local, situacao, criado_em) VALUES (?, ?, ?, 'imunizacao', ?, 'pendente', ?)`,
          [m.est, m.paciente, vacina, `ria-${P}-${vacina}`, new Date()],
        );
      } finally {
        await e.executar('SET FOREIGN_KEY_CHECKS = 1');
      }
    });
    const r = await postarERegistrar(
      config(),
      P,
      '{"resourceType":"Bundle"}',
      `${P}-ria-${vacina}-v0`,
      (tx) =>
        garantirEnvioRnds(
          tx,
          dadosEnvioVacina(P, 'fato.vacina.aplicada', 0, vacina, m.paciente, '0'),
          new Date(),
        ).then((id) => ({ envio: id, numero: 1 })),
    );
    expect(r.recibo).toBeTruthy();
    const [en] = await ler(
      'SELECT id, situacao, versao_atual FROM envio_rnds WHERE identificador_local = ?',
      [`ria-${P}-${vacina}`],
    );
    expect(en).toMatchObject({ id: envio, situacao: 'aceito', versao_atual: 1 });
    const vs = await ler(
      'SELECT numero_versao, tipo_versao, situacao FROM envio_rnds_versao WHERE envio_rnds_id = ?',
      [envio],
    );
    expect(vs).toEqual([{ numero_versao: 1, tipo_versao: 'original', situacao: 'aceito' }]);
  });
});
