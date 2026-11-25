// Contrato de efeito do registro único da impressão da prescrição (01-ADM L82), contra o MariaDB real (cliente de
// teste f22_o5): a 1ª via grava em exportacao_documento a linha "impressao" com a justificativa, quem imprimiu, o
// paciente, o atendimento e o resumo do PDF; a nova via grava "reimpressao" com o motivo; sem texto, a prescrição de
// outro paciente ou de outro estabelecimento não grava nada; cada gravação vai à trilha com o motivo. Massa
// SINTÉTICA (prefixo l82pi), montada no beforeAll e apagada no início e no fim (a trilha pelo utilitário comum).
// SGH_NUCLEO_SEM_BANCO=1 pula.
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { PortaPrescricaoPropria } from './prescricao-porta-propria.js';

const CLIENTE = 'f22_o5';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const P = 'l82pi';
const OUTRO = `${P}b`;
const LOGIN = `${P}med`;
const HASH = 'a'.repeat(64);
const ctx = (hospital: string) => ({
  cliente: CLIENTE,
  estabelecimento: null,
  usuario: null,
  correlacao: P,
  rede: 'rede-teste',
  hospital,
});
const recusada = (codigo: string) => ({ problema: { codigo } });

interface Massa {
  readonly est: number;
  readonly usuario: number;
  readonly paciente: number;
  readonly outroPaciente: number;
  readonly atendimento: number;
  readonly prescricao: number;
}

async function limpar(e: Escritor): Promise<void> {
  await limparTrilhaDaMassa(e, { codigos: [P, OUTRO] });
  const ests = '(SELECT id FROM estabelecimento WHERE codigo IN (?, ?))';
  await e.executar(`DELETE FROM exportacao_documento WHERE estabelecimento_id IN ${ests}`, [P, OUTRO]);
  await e.executar(`DELETE FROM idempotencia_operacao WHERE estabelecimento_id IN ${ests}`, [P, OUTRO]);
  await e.executar(`DELETE FROM prescricao WHERE estabelecimento_id IN ${ests}`, [P, OUTRO]);
  await e.executar(`DELETE FROM atendimento WHERE estabelecimento_id IN ${ests}`, [P, OUTRO]);
  await e.executar(
    'DELETE FROM paciente WHERE pessoa_fisica_id IN (SELECT id FROM pessoa_fisica WHERE nome LIKE ?)',
    [`${P} %`],
  );
  await e.executar('DELETE FROM profissional WHERE nome_exibicao LIKE ?', [`${P} %`]);
  await e.executar('DELETE FROM pessoa_fisica WHERE nome LIKE ?', [`${P} %`]);
  await e.executar('DELETE FROM usuario WHERE login = ?', [LOGIN]);
  await e.executar('DELETE FROM estabelecimento WHERE codigo IN (?, ?)', [P, OUTRO]);
}

async function montar(nucleo: NucleoProprio): Promise<Massa> {
  return nucleo.escrever({ cliente: CLIENTE, correlacao: `preparo-${P}` }, async (e) => {
    await e.executar('SET FOREIGN_KEY_CHECKS = 0');
    try {
      await limpar(e);
      const agora = new Date();
      const ins = (sql: string, p: unknown[]) => e.inserir(sql, [...p, agora]);
      const estab = (codigo: string) =>
        ins(
          `INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, fuso_horario, criado_em)
           VALUES (?, 'Hospital sintético', 'Hospital sintético (fictício)', 'America/Sao_Paulo', ?)`,
          [codigo],
        );
      const est = await estab(P);
      await estab(OUTRO);
      const usuario = await ins(
        `INSERT INTO usuario (login, nome, tipo_conta, criado_em) VALUES (?, 'Usuário sintético', 'servico', ?)`,
        [LOGIN],
      );
      const pessoa = (n: string) =>
        ins('INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, ?)', [`${P} ${n}`]);
      const paciente = async (n: string, prontuario: number) =>
        ins('INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, criado_em) VALUES (?, ?, ?)', [
          await pessoa(n),
          prontuario,
        ]);
      const pac = await paciente('Paciente', 982_061_01);
      const outroPaciente = await paciente('Outro', 982_061_02);
      const prof = await ins(
        `INSERT INTO profissional (pessoa_fisica_id, tipo, nome_exibicao, criado_em) VALUES (?, 'corpo_clinico', ?, ?)`,
        [await pessoa('Prescritor'), `${P} Prescritor`],
      );
      // Os cadastros de apoio do atendimento não importam para este contrato: as chaves ficam desligadas no preparo.
      const atendimento = await e.inserir(
        `INSERT INTO atendimento (estabelecimento_id, numero, paciente_id, categoria_atendimento_id,
           carater_atendimento_tiss_id, fonte_pagadora_id, profissional_id, entrada_em, criado_em, situacao)
         SELECT ?, 'L82PI-1', ?, (SELECT MIN(id) FROM categoria_atendimento),
                (SELECT MIN(id) FROM carater_atendimento_tiss), (SELECT MIN(id) FROM fonte_pagadora), ?, ?, ?, 'aberto'`,
        [est, pac, prof, agora, agora],
      );
      const prescricao = await e.inserir(
        `INSERT INTO prescricao (estabelecimento_id, numero, paciente_id, atendimento_id, prescritor_profissional_id,
           tipo, situacao, prescrito_em, vigencia_inicio_em, vigencia_fim_em, criado_em)
         VALUES (?, 982061, ?, ?, ?, 'medica', 'vigente', ?, ?, ?, ?)`,
        [est, pac, atendimento, prof, agora, agora, new Date(Date.now() + 24 * 3_600_000), agora],
      );
      return { est, usuario, paciente: pac, outroPaciente, atendimento, prescricao };
    } finally {
      await e.executar('SET FOREIGN_KEY_CHECKS = 1');
    }
  });
}

describe.skipIf(SEM_BANCO)('registro único da impressão da prescrição (integração, 01-ADM L82)', () => {
  let nucleo: NucleoProprio;
  let m: Massa;
  let porta: PortaPrescricaoPropria;
  const ler = (sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: P }, (l) => l.consultar(sql, p));
  const total = async () =>
    Number(
      (await ler('SELECT COUNT(*) AS n FROM exportacao_documento WHERE estabelecimento_id = ?', [m.est]))[0]![
        'n'
      ],
    );

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE)).banco).toBe(`cliente_${CLIENTE}`);
    m = await montar(nucleo);
    porta = new PortaPrescricaoPropria(nucleo, CLIENTE);
  }, 120_000);
  afterAll(async () => {
    if (!nucleo) return;
    await nucleo.escrever({ cliente: CLIENTE, correlacao: `limpeza-${P}` }, async (e) => {
      await e.executar('SET FOREIGN_KEY_CHECKS = 0');
      try {
        await limpar(e);
      } finally {
        await e.executar('SET FOREIGN_KEY_CHECKS = 1');
      }
    });
    await nucleo.encerrar();
  });

  it('a 1ª via e a nova via ficam no registro único, com quem, quando, paciente, atendimento e o porquê', async () => {
    const id1 = await porta.registrarImpressao(ctx(P), LOGIN, {
      paciente: m.paciente,
      prescricao: m.prescricao,
      via: 1,
      justificativa: '  Entrega ao paciente na alta ',
      hash: HASH,
    });
    const id2 = await porta.registrarImpressao(ctx(P), LOGIN, {
      paciente: m.paciente,
      prescricao: m.prescricao,
      via: 2,
      justificativa: 'Via extraviada na enfermaria',
      hash: null,
    });
    const linhas = await ler(
      `SELECT id, estabelecimento_id, entidade, entidade_id, paciente_id, atendimento_id, tipo_operacao, formato,
              destino, justificativa, hash_sha256, usuario_id, ocorrido_em IS NOT NULL AS quando,
              JSON_VALUE(dados, '$.via') AS via
         FROM exportacao_documento WHERE id IN (?, ?) ORDER BY id`,
      [id1, id2],
    );
    const comum = {
      estabelecimento_id: m.est,
      entidade: 'prescricao',
      entidade_id: m.prescricao,
      paciente_id: m.paciente,
      atendimento_id: m.atendimento,
      formato: 'pdf',
      destino: 'download',
      usuario_id: m.usuario,
      quando: 1,
    };
    expect(linhas.map((x) => ({ ...x, via: Number(x['via']) }))).toMatchObject([
      {
        ...comum,
        id: id1,
        tipo_operacao: 'impressao',
        justificativa: 'Entrega ao paciente na alta',
        hash_sha256: HASH,
        via: 1,
      },
      {
        ...comum,
        id: id2,
        tipo_operacao: 'reimpressao',
        justificativa: 'Via extraviada na enfermaria',
        hash_sha256: null,
        via: 2,
      },
    ]);
    // A trilha na mesma transação: uma linha por via, com o motivo e o alvo no registro único.
    const trilha = await ler(
      `SELECT entidade_id, motivo FROM trilha_auditoria
        WHERE estabelecimento_id = ? AND entidade = 'exportacao_documento' ORDER BY id`,
      [m.est],
    );
    expect(trilha.map((t) => ({ id: Number(t['entidade_id']), motivo: t['motivo'] }))).toEqual([
      { id: id1, motivo: 'Entrega ao paciente na alta' },
      { id: id2, motivo: 'Via extraviada na enfermaria' },
    ]);
  });

  it('sem o texto, com outro paciente ou em outro estabelecimento: recusa e nada gravado', async () => {
    const antes = await total();
    const pedido = {
      paciente: m.paciente,
      prescricao: m.prescricao,
      via: 1,
      justificativa: 'Auditoria do convênio',
    };
    await expect(
      porta.registrarImpressao(ctx(P), LOGIN, { ...pedido, justificativa: '   ' }),
    ).rejects.toMatchObject(recusada('justificativa-obrigatoria'));
    await expect(
      porta.registrarImpressao(ctx(P), LOGIN, { ...pedido, via: 2, justificativa: '' }),
    ).rejects.toMatchObject(recusada('motivo-obrigatorio'));
    await expect(
      porta.registrarImpressao(ctx(P), LOGIN, { ...pedido, paciente: m.outroPaciente }),
    ).rejects.toMatchObject(recusada('registro-inexistente'));
    await expect(porta.registrarImpressao(ctx(OUTRO), LOGIN, pedido)).rejects.toMatchObject(
      recusada('registro-inexistente'),
    );
    await expect(porta.registrarImpressao(ctx(P), `${P}nao`, pedido)).rejects.toMatchObject(
      recusada('usuario-inexistente'),
    );
    expect(await total()).toBe(antes);
  });
});
