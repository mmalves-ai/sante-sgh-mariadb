// Contrato de efeito do texto padrão da descrição cirúrgica (F3.4, 04-CC linha 91) contra o MariaDB real (cliente de
// teste). Massa SINTÉTICA: estabelecimento com o código do teste (para a sessão e a trilha) e um procedimento cirúrgico
// fictício; usuário e profissionais são ids já existentes do cliente de teste (só lidos, nunca alterados).
// Prova o que fica no banco: a inclusão com `tem_campos_preencher` apurado do texto, o título repetido recusado (409)
// sem linha nova, a alteração com a versão +1, o texto pessoal de outro cirurgião recusado sem a gestão do bloco (403),
// tirar de uso sem apagar, a oferta para a descrição só com os ativos e o preenchimento recusado no texto fora de uso.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { PortaTextoPadraoCirurgiaPropria } from './texto-padrao-propria.js';

const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o4';
const P = 'f343txt';

interface Massa {
  usuario: number;
  /** O profissional ligado ao usuário (nulo: o cliente de teste não tem usuário ligado a profissional). */
  meu: number | null;
  outro: number;
  proc: number;
}

async function limpar(e: Escritor): Promise<void> {
  await e.executar(
    `DELETE t FROM texto_padrao_cirurgia t JOIN procedimento_cirurgico p ON p.id = t.procedimento_cirurgico_id
      WHERE p.codigo = ?`,
    [`${P}-PC`],
  );
  await e.executar('DELETE FROM procedimento_cirurgico WHERE codigo = ?', [`${P}-PC`]);
  await limparTrilhaDaMassa(e, { codigos: [P] });
  await e.executar('DELETE FROM estabelecimento WHERE codigo = ?', [P]);
}

describe.skipIf(SEM_BANCO)('PortaTextoPadraoCirurgiaPropria contra o MariaDB (contrato de efeito)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaTextoPadraoCirurgiaPropria;
  let m: Massa;
  const ctx = () => ({ cliente: CLIENTE, hospital: P, usuario: m.usuario, correlacao: P });
  const ler = <T = Record<string, unknown>>(sql: string, p: unknown[] = []) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: P }, (l) => l.consultar(sql, p)) as Promise<T[]>;
  const comum = { gestor: false };
  const gestor = { gestor: true };

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await nucleo.escrever({ cliente: CLIENTE, correlacao: `preparo-${P}` }, async (e) => {
      await limpar(e);
      const agora = new Date();
      const ligado = await e.uma(
        'SELECT usuario_id, profissional_id FROM usuario_profissional WHERE usuario_vigente_id IS NOT NULL ORDER BY id LIMIT 1',
      );
      const usuario = ligado
        ? { id: ligado['usuario_id'] }
        : await e.uma('SELECT MIN(id) AS id FROM usuario WHERE excluido_em IS NULL');
      const meu = ligado ? Number(ligado['profissional_id']) : null;
      const outro = await e.uma(
        'SELECT MIN(id) AS id FROM profissional WHERE excluido_em IS NULL AND id <> ?',
        [meu ?? 0],
      );
      if (!usuario?.['id'] || !outro?.['id'])
        throw new Error('O cliente de teste precisa de usuário e profissional.');
      await e.inserir(
        `INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, fuso_horario, criado_em)
         VALUES (?, ?, ?, 'America/Sao_Paulo', ?)`,
        [P, `Hospital sintético ${P}`, `Hospital sintético ${P} (fictício)`, agora],
      );
      const proc = await e.inserir(
        'INSERT INTO procedimento_cirurgico (codigo, descricao, criado_em) VALUES (?, ?, ?)',
        [`${P}-PC`, 'PROCEDIMENTO SINTETICO F343', agora],
      );
      return { usuario: Number(usuario['id']), meu, outro: Number(outro['id']), proc };
    });
    porta = new PortaTextoPadraoCirurgiaPropria(nucleo, CLIENTE);
  }, 60_000);

  afterAll(async () => {
    if (nucleo) {
      await nucleo.escrever({ cliente: CLIENTE, correlacao: `limpeza-${P}` }, limpar);
      await nucleo.encerrar?.();
    }
  });

  const texto = (titulo: string, extra: Record<string, unknown> = {}) => ({
    titulo,
    procedimento: m.proc,
    cirurgiao: null,
    textoDescricao: 'Incisão {{via}} com {{fio}}.',
    textoRisco: null,
    textoIntercorrencia: null,
    ...extra,
  });

  it('inclui, recusa título repetido e marcação quebrada, altera com versão e tira de uso sem apagar', async () => {
    const a = await porta.incluir(ctx(), texto('Padrão do serviço'), comum);
    const [la] = await ler(
      'SELECT tem_campos_preencher, ativo, versao, criado_por FROM texto_padrao_cirurgia WHERE id = ?',
      [a.id],
    );
    expect([Number(la!['tem_campos_preencher']), Number(la!['ativo']), Number(la!['versao'])]).toEqual([
      1, 1, 1,
    ]);
    await expect(porta.incluir(ctx(), texto('Padrão do serviço'), comum)).rejects.toMatchObject({
      problema: { status: 409 },
    });
    await expect(
      porta.incluir(ctx(), texto('Marcação quebrada', { textoDescricao: 'Via {{via' }), comum),
    ).rejects.toMatchObject({ problema: { status: 422 } });
    const [n] = await ler(
      'SELECT COUNT(*) AS n FROM texto_padrao_cirurgia WHERE procedimento_cirurgico_id = ?',
      [m.proc],
    );
    expect(Number(n!['n'])).toBe(1);

    await porta.alterar(
      ctx(),
      a.id,
      { ...texto('Padrão do serviço'), textoDescricao: 'Sem campos.', versao: 1 },
      comum,
    );
    const [lb] = await ler('SELECT tem_campos_preencher, versao FROM texto_padrao_cirurgia WHERE id = ?', [
      a.id,
    ]);
    expect([Number(lb!['tem_campos_preencher']), Number(lb!['versao'])]).toEqual([0, 2]);

    await porta.definirUso(ctx(), a.id, { ativo: false, versao: 2 }, comum);
    const [lc] = await ler('SELECT ativo, versao FROM texto_padrao_cirurgia WHERE id = ?', [a.id]);
    expect([Number(lc!['ativo']), Number(lc!['versao'])]).toEqual([0, 3]);
    // Fora de uso: some da oferta e não se preenche.
    const oferta = await porta.listar(ctx(), { paraDescricao: true, procedimento: m.proc, cirurgiao: null });
    expect(oferta.map((t) => t.id)).not.toContain(a.id);
    await expect(porta.preencher(ctx(), a.id, { valores: {} })).rejects.toMatchObject({
      problema: { status: 422 },
    });
    const [tr] = await ler(
      'SELECT COUNT(*) AS n FROM trilha_auditoria WHERE estabelecimento_id = (SELECT id FROM estabelecimento WHERE codigo = ?)',
      [P],
    );
    expect(Number(tr!['n'])).toBeGreaterThanOrEqual(3);
  });

  it('texto pessoal: de outro cirurgião só com a gestão do bloco; o próprio cirurgião mantém o seu; oferta na ordem', async () => {
    await expect(
      porta.incluir(ctx(), texto('Pessoal de outro', { cirurgiao: m.outro }), comum),
    ).rejects.toMatchObject({ problema: { status: 403 } });
    const o = await porta.incluir(ctx(), texto('Pessoal de outro', { cirurgiao: m.outro }), gestor);
    await expect(porta.definirUso(ctx(), o.id, { ativo: false, versao: 1 }, comum)).rejects.toMatchObject({
      problema: { status: 403 },
    });
    const [lo] = await ler('SELECT ativo, versao FROM texto_padrao_cirurgia WHERE id = ?', [o.id]);
    expect([Number(lo!['ativo']), Number(lo!['versao'])]).toEqual([1, 1]);

    const s = await porta.incluir(ctx(), texto('Serviço ativo'), comum);
    const oferta = await porta.listar(ctx(), {
      paraDescricao: true,
      procedimento: m.proc,
      cirurgiao: m.outro,
    });
    expect(oferta.map((t) => t.id)).toEqual([o.id, s.id]);
    const preenchido = await porta.preencher(ctx(), o.id, { valores: { via: 'mediana' } });
    expect(preenchido).toMatchObject({ textoDescricao: 'Incisão mediana com {{fio}}.', faltando: ['fio'] });

    if (m.meu !== null) {
      const meu = await porta.incluir(ctx(), texto('Meu texto', { cirurgiao: m.meu }), comum);
      await porta.definirUso(ctx(), meu.id, { ativo: false, versao: 1 }, comum);
      const [lm] = await ler('SELECT ativo FROM texto_padrao_cirurgia WHERE id = ?', [meu.id]);
      expect(Number(lm!['ativo'])).toBe(0);
    }
  });
});
