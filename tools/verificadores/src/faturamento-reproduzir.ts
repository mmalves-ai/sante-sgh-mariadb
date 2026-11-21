// pnpm faturamento:reproduzir -- --cliente=<código> --de=AAAA-MM --ate=AAAA-MM [--hospital=<cod|todos>]
// [--amostra=<n>] (ficha do M30, seção 10; cap-14 §14.4.2): o explicador de preço sobre os itens da conta de cada mês e
// grupo, por amostra determinística, com o relatório agregado por grupo, convênio e causa em
// docs/marcos/M30/reproducao.md e o grupo apto quando o acerto atinge a meta (99% SADT e diárias e taxas, 98% mat/med,
// 97% honorários). Só leitura; só AMBIENTE=dev em loopback.
// No banco próprio, a reprodução fica indisponível (recusa explícita, nunca relatório vazio) até existir a leitura
// dos itens de conta importados com o preço gravado e a regra de preço que os explica (pedido do lote 05-10).
import { META_REPRODUCAO, ROTULO_GRUPO } from '@sgh/dominio-faturamento';
import { ErroIndisponivel } from './indisponivel.ts';

const args = process.argv.slice(2);
const opc = (n: string) => args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const de = opc('de') ?? '2025-01';
const ate = opc('ate') ?? '2026-06';
if (!/^\d{4}-\d{2}$/.test(de) || !/^\d{4}-\d{2}$/.test(ate) || de > ate) {
  console.error(
    'Uso: pnpm faturamento:reproduzir -- --cliente=<código> --de=AAAA-MM --ate=AAAA-MM [--hospital=<cod>] [--amostra=<n>]',
  );
  process.exit(2);
}
const metas = Object.entries(META_REPRODUCAO)
  .map(([g, m]) => `${ROTULO_GRUPO[g as keyof typeof ROTULO_GRUPO]} ${(m * 100).toFixed(0)}%`)
  .join(', ');
console.error(
  new ErroIndisponivel(
    `faturamento:reproduzir ${de} a ${ate} (metas: ${metas})`,
    'leitura dos itens de conta com o preço gravado na origem (conta_hospitalar e itens, campos de preço de ' +
      'origem preservados pelo conector) e o explicador de preço do domínio sobre o modelo próprio',
  ).message,
);
process.exit(1);
