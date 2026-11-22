// Integração do registro PRÓPRIO da quebra de vidro contra o MariaDB real, no cliente de teste da onda 1 (f22_o1).
// Massa SINTÉTICA do lote 01-04 (estabelecimento l0104e, usuário teste.l0104e, paciente e estação fictícios, motivo
// L0104-TESTE), idempotente no beforeAll e limpa no afterAll. Contrato de efeito: a linha de acesso_emergencial (IP e
// estação), a trilha com o código auditável da quebra de vidro e o alerta ao Auditor no outbox com o tipo e as chaves
// que o relay e o EmailService do worker consomem; e a recusa do motivo inexistente.
// SGH_NUCLEO_SEM_BANCO=1 pula o arquivo.
import { randomUUID } from 'node:crypto';
import { EVENTOS_AUDITAVEIS } from '@sgh/contratos';
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  PONTO_ALERTA_EMERGENCIA,
  RegistroEmergenciaPropria,
  RELAY_ENTREGA_ALERTA_EMERGENCIA,
} from './emergencia.controller.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o1';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const EST = 'l0104e';
const LOGIN = 'teste.l0104e';
const MOTIVO = 'L0104-TESTE';
const IP = '10.99.4.4';

describe.skipIf(SEM_BANCO)('registro próprio da quebra de vidro contra o MariaDB (cliente f22_o1)', () => {
  let nucleo: NucleoProprio;
  let registro: RegistroEmergenciaPropria;
  const ids = { est: 0, paciente: 0, estacao: 0 };

  async function garantir(
    e: Escritor,
    sel: string,
    p: unknown[],
    ins: string,
    pi: unknown[],
  ): Promise<number> {
    const l = await e.uma<{ id: number }>(sel, p);
    return l ? Number(l.id) : e.inserir(ins, pi);
  }
  async function limpar(e: Escritor) {
    if (!ids.est) return;
    await e.executar(
      "DELETE FROM integracao_mensagem WHERE estabelecimento_id = ? AND entidade = 'acesso_emergencial'",
      [ids.est],
    );
    await e.executar('DELETE FROM acesso_emergencial WHERE estabelecimento_id = ?', [ids.est]);
  }
  const linha = (sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'teste-l0104e-conferir' }, (l) => l.uma(sql, p));
  const pedido = (motivo = MOTIVO) => ({
    rede: 'teste',
    hospital: EST,
    idUsuario: 1,
    login: LOGIN,
    idPaciente: ids.paciente,
    atendimento: null,
    motivo,
    justificativa: 'Justificativa sintética do teste de integração',
    minutos: 30,
    estacao: `teste:${IP}`,
    enderecoIp: IP,
    correlacao: `teste-l0104e-${randomUUID()}`,
  });

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE)).banco).toBe(`cliente_${CLIENTE}`);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-l0104e' }, async (e) => {
      const agora = new Date();
      ids.est = await garantir(
        e,
        'SELECT id FROM estabelecimento WHERE codigo = ?',
        [EST],
        'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
        [EST, `Hospital sintético ${EST}`, `Hospital sintético ${EST} (fictício)`, agora],
      );
      await garantir(
        e,
        'SELECT id FROM usuario WHERE login = ?',
        [LOGIN],
        'INSERT INTO usuario (login, nome, dispensa_cpf, criado_em) VALUES (?, ?, TRUE, ?)',
        [LOGIN, 'USUARIO SINTETICO L0104E', agora],
      );
      const pf = await garantir(
        e,
        'SELECT id FROM pessoa_fisica WHERE nome = ?',
        ['PACIENTE SINTETICO L0104E'],
        'INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, ?)',
        ['PACIENTE SINTETICO L0104E', agora],
      );
      ids.paciente = await garantir(
        e,
        'SELECT id FROM paciente WHERE pessoa_fisica_id = ?',
        [pf],
        'INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, criado_em) VALUES (?, ?, ?)',
        [pf, 9104901, agora],
      );
      await garantir(
        e,
        'SELECT id FROM motivo_acesso_emergencial WHERE codigo = ?',
        [MOTIVO],
        'INSERT INTO motivo_acesso_emergencial (codigo, descricao, criado_em) VALUES (?, ?, ?)',
        [MOTIVO, 'Motivo sintético do teste', agora],
      );
      ids.estacao = await garantir(
        e,
        'SELECT id FROM estacao_trabalho WHERE estabelecimento_id = ? AND codigo = ?',
        [ids.est, 'L0104E-1'],
        'INSERT INTO estacao_trabalho (estabelecimento_id, codigo, nome, endereco_ip, criado_em) VALUES (?, ?, ?, ?, ?)',
        [ids.est, 'L0104E-1', 'Estação sintética L0104E', IP, agora],
      );
      await limpar(e);
    });
    registro = new RegistroEmergenciaPropria(nucleo, CLIENTE);
  }, 120_000);

  afterAll(async () => {
    if (!nucleo) return;
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-l0104e' }, (e) => limpar(e));
    await nucleo.encerrar();
  });

  it('abre: linha com IP e estação, trilha com o código auditável e alerta no outbox no formato do worker', async () => {
    const r = await registro.abrir(pedido());
    // Enquanto o relay não entrega o ponto, o controlador manda o alerta direto (alertaNaOutbox false).
    expect(r.alertaNaOutbox).toBe(RELAY_ENTREGA_ALERTA_EMERGENCIA);
    const id = Number(r.id);
    expect(
      await linha(
        'SELECT situacao, endereco_ip, estacao_trabalho_id, estabelecimento_id FROM acesso_emergencial WHERE id = ?',
        [id],
      ),
    ).toMatchObject({
      situacao: 'ativo',
      endereco_ip: IP,
      estacao_trabalho_id: ids.estacao,
      estabelecimento_id: ids.est,
    });
    const t = await linha(
      `SELECT JSON_UNQUOTE(JSON_EXTRACT(dados_depois, '$.operacao')) AS operacao, endereco_ip
       FROM trilha_auditoria WHERE entidade = 'acesso_emergencial' AND entidade_id = ? ORDER BY id DESC LIMIT 1`,
      [id],
    );
    expect(t).toMatchObject({ operacao: EVENTOS_AUDITAVEIS.emergenciaAberta.codigo, endereco_ip: IP });
    const m = await linha(
      "SELECT ponto, conteudo FROM integracao_mensagem WHERE entidade = 'acesso_emergencial' AND entidade_id = ?",
      [id],
    );
    expect(m?.['ponto']).toBe(PONTO_ALERTA_EMERGENCIA);
    const carga = (
      typeof m?.['conteudo'] === 'string' ? JSON.parse(m['conteudo']) : m?.['conteudo']
    ) as Record<string, unknown>;
    // As chaves que o EmailService confere (todas texto no formato de código), mais o cliente que o executor junta.
    expect(Object.keys(carga).sort()).toEqual(
      ['cliente', 'fim', 'hospital', 'idEmergencia', 'idUsuario', 'inicio', 'motivo', 'rede'].sort(),
    );
    expect(carga).toMatchObject({
      rede: 'teste',
      hospital: EST,
      idEmergencia: String(id),
      motivo: MOTIVO,
      inicio: r.inicio.toISOString(),
    });
    for (const k of ['rede', 'hospital', 'idEmergencia', 'idUsuario', 'motivo', 'inicio', 'fim'])
      expect(carga[k]).toMatch(/^[A-Za-z0-9._:-]{1,64}$/);
    expect(await registro.vigente(EST, LOGIN, ids.paciente)).toMatchObject({ id: r.id });
  });

  it('motivo fora do domínio do cliente é recusa de negócio (409), sem linha nem alerta', async () => {
    const antes = await linha('SELECT COUNT(*) AS n FROM acesso_emergencial WHERE estabelecimento_id = ?', [
      ids.est,
    ]);
    await expect(registro.abrir(pedido('L0104-NAO-EXISTE'))).rejects.toMatchObject({
      problema: expect.objectContaining({ codigo: 'motivo-inexistente', status: 409 }),
    });
    expect(
      await linha('SELECT COUNT(*) AS n FROM acesso_emergencial WHERE estabelecimento_id = ?', [ids.est]),
    ).toEqual(antes);
  });
});
