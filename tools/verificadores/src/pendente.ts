// Marcador de comando que ainda não existe: imprime PENDENTE e sai com 0 (nunca conta como verde).
const [marco = 'M??', script = '?'] = process.argv.slice(2);
console.log(`PENDENTE: ${marco} (pnpm ${script}) — comando criado no marco ${marco}; nada foi verificado.`);
