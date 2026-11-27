// Contrato de efeito da exportação dos profissionais ao cadastro nacional (C3-011, 02-CAD linha 29, item 3): gera o
// arquivo das lotações vigentes, guarda pela porta de armazenamento (registro `arquivo` imutável, com hash e guarda
// legal) e grava a remessa_cnes tipo 'exportacao', situação 'exportada', com exportada_em e arquivo_id; a lotação com
// pendência fica fora do arquivo e é contada. Massa sintética (número nacional 9999965, CPF de teste) apagada no fim.
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { armazemSusMemoria } from './armazem.js';
import { PortaExportacaoCnesPropria } from './exportacao-cnes-propria.js';

const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o4';
const P = 'c3011exp';
const CNES = '9999965';
const NOME = 'Profissional sintético C3-011 exportação';

async function limpar(e: Escritor): Promise<void> {
  const est = '(SELECT id FROM estabelecimento WHERE codigo = ?)';
  const rem = `SELECT arquivo_id FROM remessa_cnes WHERE estabelecimento_id IN ${est}`;
  const arqs = (await e.consultar(rem, [P])).map((r) => r['arquivo_id']).filter((x) => x !== null);
  await e.executar(`DELETE FROM remessa_cnes WHERE estabelecimento_id IN ${est}`, [P]);
  for (const a of arqs) await e.executar('DELETE FROM arquivo WHERE id = ?', [a]);
  await e.executar(`DELETE FROM lotacao_profissional WHERE estabelecimento_id IN ${est}`, [P]);
  await e.executar(
    'DELETE FROM profissional WHERE pessoa_fisica_id IN (SELECT id FROM pessoa_fisica WHERE nome LIKE ?)',
    [`${NOME}%`],
  );
  await e.executar('DELETE FROM pessoa_fisica WHERE nome LIKE ?', [`${NOME}%`]);
  await e.executar("DELETE FROM ocupacao_cbo WHERE codigo_cbo = '999965'");
  await e.executar("DELETE FROM tipo_vinculo_trabalho WHERE codigo_cnes = 'Z9'");
  await limparTrilhaDaMassa(e, { codigos: [P] });
  await e.executar('DELETE FROM estabelecimento WHERE codigo = ?', [P]);
}

describe.skipIf(SEM_BANCO)('Exportação dos profissionais ao cadastro nacional (contrato de efeito)', () => {
  let nucleo: NucleoProprio;
  const armazem = armazemSusMemoria();
  let porta: PortaExportacaoCnesPropria;
  let m: { est: number; usuario: number };
  const ctx = () => ({ cliente: CLIENTE, hospital: P, usuario: m.usuario, correlacao: P });
  const ler = (sql: string, p: unknown[] = []) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: P }, (l) => l.consultar(sql, p));

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    porta = new PortaExportacaoCnesPropria(nucleo, CLIENTE, armazem);
    m = await nucleo.escrever({ cliente: CLIENTE, correlacao: `preparo-${P}` }, async (e) => {
      await limpar(e);
      const agora = new Date();
      const usuario = await e.uma('SELECT MIN(id) AS id FROM usuario WHERE excluido_em IS NULL');
      if (!usuario?.['id']) throw new Error('O cliente de teste precisa de usuário.');
      // Catálogos sintéticos (códigos fora do oficial), para não depender da carga do cliente de teste.
      const cbo = await e.inserir(
        "INSERT INTO ocupacao_cbo (codigo_cbo, descricao, area_saude, criado_em) VALUES ('999965', 'Ocupação sintética C3-011', TRUE, ?)",
        [agora],
      );
      const vinc = await e.inserir(
        `INSERT INTO tipo_vinculo_trabalho (codigo_cnes, nivel, codigo_vinculo, descricao, criado_em)
         VALUES ('Z9', 'vinculo', 'Z9', 'Vínculo sintético C3-011', ?)`,
        [agora],
      );
      const est = await e.inserir(
        `INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, codigo_cnes, cnpj, fuso_horario, criado_em)
         VALUES (?, 'Hospital sintético C3-011 exp', 'Hospital sintético C3-011 exp (fictício)', ?, '00000000000191',
                 'America/Sao_Paulo', ?)`,
        [P, CNES, agora],
      );
      // Duas lotações: a completa entra no arquivo; a sem vínculo fica como pendência.
      for (const [sufixo, cpf, vinculo] of [
        [' A', '52998224725', vinc],
        [' B', '11144477735', null],
      ] as const) {
        const pf = await e.inserir('INSERT INTO pessoa_fisica (nome, cpf, criado_em) VALUES (?, ?, ?)', [
          `${NOME}${sufixo}`,
          cpf,
          agora,
        ]);
        const prof = await e.inserir(
          "INSERT INTO profissional (pessoa_fisica_id, tipo, criado_em) VALUES (?, 'corpo_clinico', ?)",
          [pf, agora],
        );
        await e.inserir(
          `INSERT INTO lotacao_profissional (profissional_id, estabelecimento_id, ocupacao_cbo_id, tipo_vinculo_trabalho_id,
                  carga_horaria_ambulatorial, carga_horaria_hospitalar, atende_sus, vigencia_inicio, criado_em)
           VALUES (?, ?, ?, ?, 20, 10, TRUE, '2020-01-01', ?)`,
          [prof, est, cbo, vinculo, agora],
        );
      }
      return { est, usuario: Number(usuario['id']) };
    });
  }, 60_000);

  afterAll(async () => {
    await nucleo.escrever({ cliente: CLIENTE, correlacao: `limpeza-${P}` }, limpar);
    await nucleo.encerrar();
  });

  it('gera, guarda e grava a remessa exportada com o arquivo', async () => {
    const r = await porta.exportar(ctx(), { competencia: '202611' });
    expect(r.exportados).toBe(1);
    expect(r.pendencias).toHaveLength(1);
    expect(r.pendencias[0]!.motivos).toContain('Sem vínculo de trabalho do cadastro nacional.');
    const [rem] = await ler(
      `SELECT r.tipo, r.situacao, r.exportada_em, r.arquivo_id, r.numero_remessa, r.quantidade_criticas,
              a.entidade, a.entidade_id, a.imutavel, a.retencao_ate, a.hash_sha256, a.chave_armazenamento
         FROM remessa_cnes r JOIN arquivo a ON a.id = r.arquivo_id WHERE r.id = ?`,
      [r.id],
    );
    expect(rem).toMatchObject({
      tipo: 'exportacao',
      situacao: 'exportada',
      numero_remessa: 1,
      quantidade_criticas: 1,
      entidade: 'remessa_cnes',
    });
    expect(Number(rem!['entidade_id'])).toBe(r.id);
    expect(rem!['exportada_em']).not.toBeNull();
    expect(Boolean(rem!['imutavel'])).toBe(true);
    expect(armazem.fixados.has(String(rem!['chave_armazenamento']))).toBe(true);
    const arq = await porta.arquivo(ctx(), r.id);
    expect(arq.conteudo).toContain(`cnes="${CNES}"`);
    expect(arq.conteudo).toContain('<cpf>52998224725</cpf>');
    expect(arq.conteudo).toContain('cbo="999965" vinculo="Z9"');
    expect(arq.conteudo).not.toContain('11144477735');
    const lista = await porta.exportacoes(ctx());
    expect(lista[0]).toMatchObject({ id: r.id, competencia: '202611', situacao: 'exportada' });
  });

  it('a segunda exportação da competência recebe o número seguinte', async () => {
    const r = await porta.exportar(ctx(), { competencia: '202611' });
    const [rem] = await ler('SELECT numero_remessa FROM remessa_cnes WHERE id = ?', [r.id]);
    expect(Number(rem!['numero_remessa'])).toBe(2);
  });

  it('recusa competência inválida sem gravar nada nem deixar arquivo guardado', async () => {
    const antes = armazem.objetos.size;
    await expect(porta.exportar(ctx(), { competencia: '202613' })).rejects.toThrow();
    expect(armazem.objetos.size).toBe(antes);
  });
});
