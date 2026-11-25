// Contrato de efeito dos avisos clínicos na central de avisos (F3.5, 05-SADT linha 10) contra o MariaDB real (cliente de
// teste). Massa SINTÉTICA: dois estabelecimentos com o código do teste e avisos clínicos fictícios (removidos na
// limpeza); os usuários são ids já existentes do cliente (só lidos). Prova o que fica no banco: a leitura só do próprio
// destinatário no estabelecimento da sessão, sem o cancelado e o de outro estabelecimento, com o estado, a gravidade e
// o link; a ciência grava lido_em, ciente_em, lido_usuario_id, situação 'ciente' e a versão nova (nada apagado), a
// repetida não grava de novo; a ciência do aviso de outra pessoa (404) e a do cancelado (409) não gravam nada; a trilha
// da operação no estabelecimento.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { PortaAvisosClinicosPropria } from './avisos-clinicos-propria.js';

const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o2';
const P = 'c1077avc';
const P2 = 'c1077avc2';
const ESTS = `(SELECT id FROM estabelecimento WHERE codigo IN ('${P}', '${P2}'))`;

async function limpar(e: Escritor): Promise<void> {
  await e.executar(
    `DELETE d FROM aviso_clinico_destinatario d JOIN aviso_clinico a ON a.id = d.aviso_clinico_id
      WHERE a.estabelecimento_id IN ${ESTS}`,
  );
  await e.executar(`DELETE FROM aviso_clinico WHERE estabelecimento_id IN ${ESTS}`);
  await limparTrilhaDaMassa(e, { codigos: [P, P2] });
  await e.executar('DELETE FROM estabelecimento WHERE codigo IN (?, ?)', [P, P2]);
}

describe.skipIf(SEM_BANCO)('PortaAvisosClinicosPropria contra o MariaDB (contrato de efeito)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaAvisosClinicosPropria;
  let m: {
    est: number;
    eu: number;
    outro: number;
    meu: number;
    lido: number;
    deOutro: number;
    cancelado: number;
    outroEst: number;
    paciente: number;
  };
  const ctx = (usuario = m.eu, hospital = P) => ({ cliente: CLIENTE, hospital, usuario, correlacao: P });
  const ler = <T = Record<string, unknown>>(sql: string, p: unknown[] = []) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: P }, (l) => l.consultar(sql, p)) as Promise<T[]>;
  const destinatario = async (id: number) =>
    (
      await ler(
        `SELECT situacao, lido_em IS NOT NULL AS lido, ciente_em IS NOT NULL AS ciente, lido_usuario_id, versao,
                alterado_por, excluido_em IS NULL AS vivo
           FROM aviso_clinico_destinatario WHERE id = ?`,
        [id],
      )
    )[0]!;

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await nucleo.escrever({ cliente: CLIENTE, correlacao: `preparo-${P}` }, async (e) => {
      await limpar(e);
      const agora = new Date();
      const us = await e.consultar('SELECT id FROM usuario WHERE excluido_em IS NULL ORDER BY id LIMIT 2');
      if (us.length < 2) throw new Error('O cliente de teste precisa de dois usuários.');
      const eu = Number(us[0]!['id']);
      const outro = Number(us[1]!['id']);
      const novoEst = (cod: string) =>
        e.inserir(
          `INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, fuso_horario, criado_em)
           VALUES (?, ?, ?, 'America/Sao_Paulo', ?)`,
          [cod, `Hospital sintético ${cod}`, `Hospital sintético ${cod} (fictício)`, agora],
        );
      // Ids já existentes do cliente, só lidos (as chaves estrangeiras do aviso); nenhum dado da linha é lido.
      const ref = await e.uma(
        'SELECT (SELECT MIN(id) FROM paciente) AS paciente, (SELECT MIN(id) FROM resultado_exame) AS resultado',
      );
      if (!ref?.['paciente'] || !ref['resultado'])
        throw new Error('O cliente de teste precisa de paciente e resultado.');
      const paciente = Number(ref['paciente']);
      const resultado = Number(ref['resultado']);
      const est = await novoEst(P);
      const est2 = await novoEst(P2);
      const aviso = (estab: number, titulo: string, prioridade: string, situacao: string, minutos: number) =>
        e.inserir(
          `INSERT INTO aviso_clinico (estabelecimento_id, paciente_id, resultado_exame_id, titulo, mensagem, prioridade,
                                      canal, situacao, gerado_em, modulo_origem, criado_em)
           VALUES (?, ?, ?, ?, 'Mensagem sintética do teste', ?, 'sistema', ?, ?, 'sadt.resultado', ?)`,
          [
            estab,
            paciente,
            resultado,
            titulo,
            prioridade,
            situacao,
            new Date(agora.getTime() - minutos * 60_000),
            agora,
          ],
        );
      const dest = (a: number, usuario: number, lido = false) =>
        e.inserir(
          `INSERT INTO aviso_clinico_destinatario (aviso_clinico_id, sequencia, usuario_id, canal, situacao, lido_em,
                                                   criado_em)
           VALUES (?, 1, ?, 'sistema', ?, ?, ?)`,
          [a, usuario, lido ? 'lido' : 'pendente', lido ? agora : null, agora],
        );
      const meu = await dest(await aviso(est, 'Resultado de exame retificado', 'alta', 'pendente', 5), eu);
      const lido = await dest(await aviso(est, 'Aviso sintético lido', 'normal', 'pendente', 10), eu, true);
      const deOutro = await dest(await aviso(est, 'Aviso de outra pessoa', 'alta', 'pendente', 1), outro);
      const cancelado = await dest(await aviso(est, 'Aviso cancelado', 'alta', 'cancelado', 2), eu);
      const outroEst = await dest(
        await aviso(est2, 'Aviso de outro estabelecimento', 'alta', 'pendente', 3),
        eu,
      );
      return { est, eu, outro, meu, lido, deOutro, cancelado, outroEst, paciente };
    });
    porta = new PortaAvisosClinicosPropria(nucleo, CLIENTE);
  });

  afterAll(async () => {
    if (!nucleo) return;
    await nucleo.escrever({ cliente: CLIENTE, correlacao: `limpeza-${P}` }, limpar);
    await nucleo.encerrar?.();
  });

  it('lê só os avisos do próprio destinatário no estabelecimento da sessão, sem o cancelado', async () => {
    const r = await porta.listar(ctx());
    expect(r.avisos.map((a) => a.id)).toEqual([m.meu, m.lido]);
    expect(r.novos).toBe(1);
    expect(r.avisos[0]).toMatchObject({
      titulo: 'Resultado de exame retificado',
      gravidade: 'atencao',
      estado: 'novo',
      link: `/pep/paciente/${m.paciente}/exames`,
      modulo: 'sadt.resultado',
    });
    expect(r.avisos[1]).toMatchObject({ gravidade: 'informacao', estado: 'lido' });
    expect((await porta.listar(ctx(m.outro))).avisos.map((a) => a.id)).toEqual([m.deOutro]);
    expect((await porta.listar(ctx(m.eu, P2))).avisos.map((a) => a.id)).toEqual([m.outroEst]);
  });

  it('a ciência grava no destinatário (nada apagado), a repetida não grava e vai à trilha', async () => {
    expect(await porta.ciente(ctx(), m.meu)).toEqual({ id: m.meu, gravou: true });
    const d = await destinatario(m.meu);
    expect(d).toMatchObject({ situacao: 'ciente', versao: 2 });
    expect(Number(d['lido'])).toBe(1);
    expect(Number(d['ciente'])).toBe(1);
    expect(Number(d['vivo'])).toBe(1);
    expect(Number(d['lido_usuario_id'])).toBe(m.eu);
    expect(Number(d['alterado_por'])).toBe(m.eu);
    expect(await porta.ciente(ctx(), m.meu)).toEqual({ id: m.meu, gravou: false });
    expect((await destinatario(m.meu))['versao']).toBe(2);
    const r = await porta.listar(ctx());
    expect(r.novos).toBe(0);
    expect(r.avisos.map((a) => [a.id, a.estado])).toEqual([
      [m.lido, 'lido'],
      [m.meu, 'ciente'],
    ]);
    const trilha = await ler(
      `SELECT COUNT(*) AS n FROM trilha_auditoria WHERE estabelecimento_id = ? AND correlacao = ?`,
      [m.est, P],
    );
    expect(Number(trilha[0]?.['n'])).toBeGreaterThanOrEqual(1);
  });

  it('recusa sem gravar a ciência do aviso de outra pessoa, do cancelado e do outro estabelecimento', async () => {
    await expect(porta.ciente(ctx(), m.deOutro)).rejects.toMatchObject({ problema: { status: 404 } });
    await expect(porta.ciente(ctx(), m.cancelado)).rejects.toMatchObject({ problema: { status: 409 } });
    await expect(porta.ciente(ctx(), m.outroEst)).rejects.toMatchObject({ problema: { status: 404 } });
    for (const id of [m.deOutro, m.cancelado, m.outroEst]) {
      const d = await destinatario(id);
      expect(d['versao']).toBe(1);
      expect(Number(d['ciente'])).toBe(0);
    }
  });
});
