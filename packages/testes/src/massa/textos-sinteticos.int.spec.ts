// Ida e volta dos textos sintéticos numa coluna de texto real do MariaDB (cliente f22_o5), byte a byte. Prova que a
// coluna e a conexão são utf8mb4: o corpus tem caracteres de 4 bytes, que uma coluna utf8mb3 recusaria ou trocaria.
// Coluna usada: integracao_mensagem.conteudo (LONGTEXT; o texto longo passa de 64 KiB e não caberia em TEXT).
// Tudo roda em transação DESFEITA (escrever(..., confirmar=false)): nada fica no banco. SGH_NUCLEO_SEM_BANCO=1 pula.
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CORPUS_ACENTUADO, textoLongoAcentuado } from './textos-sinteticos.js';

const CLIENTE = 'f22_o5';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';

describe.skipIf(SEM_BANCO)('textos sintéticos em coluna utf8mb4 do MariaDB (cliente f22_o5)', () => {
  let nucleo: NucleoProprio;
  const desfeito = <T>(fn: (e: Escritor) => Promise<T>) =>
    nucleo.escrever({ cliente: CLIENTE, correlacao: 'textos-f22-05-07' }, fn, false);

  beforeAll(() => {
    nucleo = new NucleoProprio();
  });
  afterAll(async () => {
    await nucleo?.encerrar?.();
  });

  it('a coluna de destino é utf8mb4', async () => {
    const l = await desfeito((e) =>
      e.uma<{ cs: string }>(
        `SELECT CHARACTER_SET_NAME AS cs FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'integracao_mensagem' AND COLUMN_NAME = 'conteudo'`,
      ),
    );
    expect(l?.cs).toBe('utf8mb4');
  });

  it.each([
    ['corpus acentuado', CORPUS_ACENTUADO],
    ['texto longo', textoLongoAcentuado()],
  ])('%s: grava e relê byte a byte; nada fica', async (_nome, texto) => {
    const lido = await desfeito(async (e) => {
      const id = await e.inserir(
        `INSERT INTO integracao_mensagem (ponto, direcao, conteudo, criado_em) VALUES ('teste_textos', 'entrada', ?, NOW(3))`,
        [texto],
      );
      return e.uma<{ conteudo: string; bytes: number; caracteres: number }>(
        `SELECT conteudo, OCTET_LENGTH(conteudo) AS bytes, CHAR_LENGTH(conteudo) AS caracteres
           FROM integracao_mensagem WHERE id = ?`,
        [id],
      );
    });
    expect(lido).not.toBeNull();
    expect(Buffer.from(lido?.conteudo ?? '', 'utf8').equals(Buffer.from(texto, 'utf8'))).toBe(true);
    expect(Number(lido?.bytes)).toBe(Buffer.byteLength(texto, 'utf8'));
    expect(Number(lido?.caracteres)).toBe([...texto].length);
    const restou = await nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'textos-f22-05-07' }, (l) =>
      l.uma<{ n: number }>(`SELECT COUNT(*) AS n FROM integracao_mensagem WHERE ponto = 'teste_textos'`),
    );
    expect(Number(restou?.n)).toBe(0);
  });
});
