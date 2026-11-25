// Contrato de efeito da central de regras de aviso clínico (F3.3, 03-PEP L133) contra o MariaDB real (cliente de
// teste). Massa SINTÉTICA: um estabelecimento com o código do teste, o tipo de aviso e as regras com o prefixo do teste
// (removidos na limpeza); os usuários e o perfil são ids já existentes do cliente (só os ids; nenhum dado da linha é
// lido), ligados ao estabelecimento sintético por acesso e perfil sintéticos. Prova o que fica no banco:
//   - tipo de aviso gravado (código, categoria, prioridade), código repetido recusado sem gravar;
//   - regra no motor de alertas (cenário aviso_clinico, evento em condicao, canais em notifica_tela/notifica_email),
//     versão 1 em regra_alerta_versao e os destinatários do estabelecimento; a alteração gera a versão 2, inativa o
//     destinatário que saiu (nunca apagado) e inclui o novo; regra sem canal recusada sem gravar;
//   - emissão: um aviso_clinico por regra que cobre o evento (regra, prioridade do tipo, janela no crítico, origem),
//     destinatários por usuário e canal (sistema e, com e-mail, a cópia por e-mail), sem o autor do evento; a central
//     de avisos do destinatário mostra o aviso uma vez só; evento sem regra não grava nada; a trilha da operação.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { PortaAvisosClinicosPropria } from '../acesso/avisos-clinicos-propria.js';
import { PortaRegrasAvisoClinicoPropria } from './avisos-clinicos-regras-propria.js';

const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o3';
const P = 'c2050avr';
const TIPO = 'c2050_vc';
const TIPO_SEM_REGRA = 'c2050_sr';
const EST = `(SELECT id FROM estabelecimento WHERE codigo = '${P}')`;
const REGRAS = `(SELECT id FROM regra_alerta WHERE codigo LIKE 'c2050-%')`;

async function limpar(e: Escritor): Promise<void> {
  await e.executar(
    `DELETE d FROM aviso_clinico_destinatario d JOIN aviso_clinico a ON a.id = d.aviso_clinico_id
      WHERE a.estabelecimento_id IN ${EST}`,
  );
  await e.executar(`DELETE FROM aviso_clinico WHERE estabelecimento_id IN ${EST}`);
  await e.executar(`DELETE FROM regra_alerta_destinatario WHERE regra_alerta_id IN ${REGRAS}`);
  await e.executar(`DELETE FROM regra_alerta_versao WHERE regra_alerta_id IN ${REGRAS}`);
  await e.executar("DELETE FROM regra_alerta WHERE codigo LIKE 'c2050-%'");
  await e.executar("DELETE FROM tipo_aviso_clinico WHERE codigo LIKE 'c2050%'");
  await e.executar(`DELETE FROM usuario_perfil WHERE estabelecimento_id IN ${EST}`);
  await e.executar(`DELETE FROM usuario_estabelecimento WHERE estabelecimento_id IN ${EST}`);
  await limparTrilhaDaMassa(e, { codigos: [P] });
  await e.executar('DELETE FROM estabelecimento WHERE codigo = ?', [P]);
}

describe.skipIf(SEM_BANCO)('PortaRegrasAvisoClinicoPropria contra o MariaDB (contrato de efeito)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaRegrasAvisoClinicoPropria;
  let m: { est: number; autor: number; u2: number; u3: number; perfil: number; paciente: number };
  let regra = 0;
  const ctx = (usuario = m.autor) => ({ cliente: CLIENTE, hospital: P, usuario, correlacao: P });
  const ler = <T = Record<string, unknown>>(sql: string, p: unknown[] = []) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: P }, (l) => l.consultar(sql, p)) as Promise<T[]>;
  const contar = async (sql: string, p: unknown[] = []) => Number((await ler(sql, p))[0]!['n']);

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await nucleo.escrever({ cliente: CLIENTE, correlacao: `preparo-${P}` }, async (e) => {
      await limpar(e);
      const agora = new Date();
      const us = await e.consultar(
        "SELECT id FROM usuario WHERE excluido_em IS NULL AND situacao = 'ativo' ORDER BY id LIMIT 3",
      );
      if (us.length < 3) throw new Error('O cliente de teste precisa de três usuários ativos.');
      const ref = await e.uma(
        `SELECT (SELECT MIN(id) FROM paciente) AS paciente,
                (SELECT MIN(id) FROM perfil_acesso WHERE excluido_em IS NULL AND estabelecimento_id IS NULL) AS perfil`,
      );
      if (!ref?.['paciente'] || !ref['perfil'])
        throw new Error('O cliente de teste precisa de paciente e perfil.');
      const est = await e.inserir(
        `INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, fuso_horario, criado_em)
         VALUES (?, ?, ?, 'America/Sao_Paulo', ?)`,
        [P, `Hospital sintético ${P}`, `Hospital sintético ${P} (fictício)`, agora],
      );
      const [autor, u2, u3] = us.map((x) => Number(x['id'])) as [number, number, number];
      for (const u of [autor, u2, u3])
        await e.inserir(
          `INSERT INTO usuario_estabelecimento (usuario_id, estabelecimento_id, padrao, vigencia_inicio, criado_em)
           VALUES (?, ?, FALSE, '2020-01-01', ?)`,
          [u, est, agora],
        );
      const perfil = Number(ref['perfil']);
      await e.inserir(
        `INSERT INTO usuario_perfil (usuario_id, perfil_acesso_id, estabelecimento_id, vigencia_inicio, criado_em)
         VALUES (?, ?, ?, '2020-01-01', ?)`,
        [u3, perfil, est, agora],
      );
      return { est, autor, u2, u3, perfil, paciente: Number(ref['paciente']) };
    });
    porta = new PortaRegrasAvisoClinicoPropria(nucleo, CLIENTE);
  });

  afterAll(async () => {
    if (!nucleo) return;
    await nucleo.escrever({ cliente: CLIENTE, correlacao: `limpeza-${P}` }, limpar);
    await nucleo.encerrar?.();
  });

  it('grava o tipo de aviso (evento clínico) e recusa o código repetido sem gravar', async () => {
    const t = await porta.gravarTipo(ctx(), {
      codigo: TIPO,
      descricao: 'Valor crítico sintético',
      categoria: 'valor_critico',
      prioridade: 'critica',
      enviaEmail: true,
      exigeCiencia: true,
    });
    await porta.gravarTipo(ctx(), { codigo: TIPO_SEM_REGRA, descricao: 'Sem regra', categoria: 'outro' });
    const [r] = await ler(
      'SELECT codigo, categoria, prioridade, envia_email, ativo FROM tipo_aviso_clinico WHERE id = ?',
      [t.id],
    );
    expect(r).toMatchObject({ codigo: TIPO, categoria: 'valor_critico', prioridade: 'critica' });
    await expect(
      porta.gravarTipo(ctx(), { codigo: TIPO, descricao: 'Outro', categoria: 'outro' }),
    ).rejects.toMatchObject({ problema: { status: 409 } });
    await expect(
      porta.gravarTipo(ctx(), { codigo: 'Inválido', descricao: 'x', categoria: 'outro' }),
    ).rejects.toMatchObject({ problema: { status: 422 } });
    expect(await contar("SELECT COUNT(*) AS n FROM tipo_aviso_clinico WHERE codigo LIKE 'c2050%'")).toBe(2);
  });

  it('grava a regra no motor de alertas com versão e destinatários; a alteração inativa quem saiu', async () => {
    const base = {
      codigo: 'c2050-r1',
      nome: 'Valor crítico avisa a equipe',
      tipoAviso: TIPO,
      mensagem: 'Resultado com valor crítico: veja o prontuário',
      canais: ['sistema', 'email'],
      vigenciaInicio: '2026-01-01',
    };
    await expect(
      porta.gravarRegra(ctx(), { ...base, canais: [], alvos: [{ tipo: 'usuario', id: m.u2 }] }),
    ).rejects.toMatchObject({ problema: { status: 422 } });
    expect(await contar("SELECT COUNT(*) AS n FROM regra_alerta WHERE codigo LIKE 'c2050-%'")).toBe(0);
    const g = await porta.gravarRegra(ctx(), {
      ...base,
      alvos: [
        { tipo: 'usuario', id: m.u2 },
        { tipo: 'perfil', id: m.perfil },
      ],
    });
    regra = g.id;
    expect(g.numeroVersao).toBe(1);
    const [r] = await ler<Record<string, unknown>>(
      `SELECT r.estabelecimento_id, ca.codigo AS cenario, r.condicao, r.notifica_tela, r.notifica_email,
              r.numero_versao_vigente, r.ativo
         FROM regra_alerta r JOIN cenario_alerta ca ON ca.id = r.cenario_alerta_id WHERE r.id = ?`,
      [regra],
    );
    expect(Number(r!['estabelecimento_id'])).toBe(m.est);
    expect(r!['cenario']).toBe('aviso_clinico');
    const cond = typeof r!['condicao'] === 'string' ? JSON.parse(r!['condicao'] as string) : r!['condicao'];
    expect(cond).toMatchObject({ tipoAviso: TIPO, setorEvento: null, especialidadeEvento: null });
    expect(Number(r!['notifica_tela'])).toBe(1);
    expect(Number(r!['notifica_email'])).toBe(1);

    const r2 = await porta.gravarRegra(ctx(), {
      ...base,
      id: regra,
      versao: 1,
      motivo: 'Troca do perfil pelo autor',
      alvos: [
        { tipo: 'usuario', id: m.u2 },
        { tipo: 'usuario', id: m.autor },
      ],
    });
    expect(r2.numeroVersao).toBe(2);
    const dest = await ler<Record<string, unknown>>(
      `SELECT tipo_destinatario, destino_id, ativo, estabelecimento_id FROM regra_alerta_destinatario
        WHERE regra_alerta_id = ? ORDER BY id`,
      [regra],
    );
    expect(dest.map((d) => [d['tipo_destinatario'], Number(d['destino_id']), Number(d['ativo'])])).toEqual([
      ['usuario', m.u2, 1],
      ['perfil', m.perfil, 0],
      ['usuario', m.autor, 1],
    ]);
    expect(dest.every((d) => Number(d['estabelecimento_id']) === m.est)).toBe(true);
    const versoes = await ler<Record<string, unknown>>(
      'SELECT numero_versao, operacao, motivo_alteracao FROM regra_alerta_versao WHERE regra_alerta_id = ? ORDER BY numero_versao',
      [regra],
    );
    expect(versoes.map((v) => [Number(v['numero_versao']), v['operacao']])).toEqual([
      [1, 'inclusao'],
      [2, 'alteracao'],
    ]);
    const painel = await porta.painel(ctx());
    expect(painel.regras.find((x) => x.id === regra)).toMatchObject({
      tipoAviso: TIPO,
      canais: ['sistema', 'email'],
      alvos: [
        { tipo: 'usuario', id: m.u2 },
        { tipo: 'usuario', id: m.autor },
      ],
      numeroVersao: 2,
    });
    expect(painel.tipos.some((t) => t.codigo === TIPO)).toBe(true);
  });

  it('o evento gera o aviso da regra para os destinatários por canal, sem o autor; sem regra, nada', async () => {
    const r = await porta.emitir(ctx(m.autor), {
      tipoAviso: TIPO,
      paciente: m.paciente,
      mensagem: 'Potássio sintético acima do limite',
      moduloOrigem: 'sadt.resultado',
      entidadeOrigem: 'resultado_exame',
      chaveOrigem: 1,
    });
    expect(r.avisos).toHaveLength(1);
    const [a] = await ler<Record<string, unknown>>(
      `SELECT regra_alerta_id, paciente_id, titulo, mensagem, prioridade, exibe_janela, situacao, modulo_origem,
              entidade_origem, criado_por
         FROM aviso_clinico WHERE id = ?`,
      [r.avisos[0]],
    );
    expect(a).toMatchObject({
      titulo: 'Valor crítico sintético',
      mensagem: 'Potássio sintético acima do limite',
      prioridade: 'critica',
      situacao: 'pendente',
      modulo_origem: 'sadt.resultado',
      entidade_origem: 'resultado_exame',
    });
    expect(Number(a!['regra_alerta_id'])).toBe(regra);
    expect(Number(a!['exibe_janela'])).toBe(1);
    expect(Number(a!['criado_por'])).toBe(m.autor);
    const d = await ler<Record<string, unknown>>(
      `SELECT usuario_id, canal, situacao, sequencia FROM aviso_clinico_destinatario
        WHERE aviso_clinico_id = ? ORDER BY sequencia`,
      [r.avisos[0]],
    );
    expect(d.length).toBe(r.destinatarios);
    expect(d.some((x) => Number(x['usuario_id']) === m.autor)).toBe(false);
    expect(d.filter((x) => x['canal'] === 'sistema').map((x) => Number(x['usuario_id']))).toEqual([m.u2]);
    expect(d.filter((x) => x['canal'] === 'email').every((x) => Number(x['usuario_id']) === m.u2)).toBe(true);
    expect(d.every((x) => x['situacao'] === 'pendente')).toBe(true);
    // A central de avisos do destinatário mostra o aviso uma vez só (a cópia por e-mail não entra na caixa).
    const caixa = await new PortaAvisosClinicosPropria(nucleo, CLIENTE).listar(ctx(m.u2));
    expect(caixa.avisos.filter((x) => x.aviso === r.avisos[0])).toHaveLength(1);
    expect(
      await contar('SELECT COUNT(*) AS n FROM trilha_auditoria WHERE estabelecimento_id = ?', [m.est]),
    ).toBeGreaterThan(0);

    const antes = await contar(`SELECT COUNT(*) AS n FROM aviso_clinico WHERE estabelecimento_id = ?`, [
      m.est,
    ]);
    expect(await porta.emitir(ctx(m.autor), { tipoAviso: TIPO_SEM_REGRA })).toEqual({
      avisos: [],
      destinatarios: 0,
    });
    expect(
      await contar(`SELECT COUNT(*) AS n FROM aviso_clinico WHERE estabelecimento_id = ?`, [m.est]),
    ).toBe(antes);
    const painel = await porta.painel(ctx());
    expect(painel.recentes.find((x) => x.id === r.avisos[0])).toMatchObject({ regra, sistema: 1 });
  });
});
