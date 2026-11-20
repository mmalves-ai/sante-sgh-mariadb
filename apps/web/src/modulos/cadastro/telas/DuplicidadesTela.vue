<script setup lang="ts">
// Unificação de prontuários: fila de duplicidades (M11; ficha, seção 7 e regras 6 e 7). Pares pelo escore
// (CPF igual primeiro; pronúncia do nome, nascimento, mãe, telefone), comparação lado a lado e "É outra
// pessoa" (grava só na tabela SGH_ e dá o alerta de homônimo na busca). M57.2: "Unificar" (escolhe o prontuário que
// fica, a justificativa e a senha) só quando a unificação estiver liberada (chave, permissão e passo 0 do executor);
// até lá o botão fica desabilitado e a tela diz o motivo.
import { SITUACOES_DUPLICIDADE, type ParDuplicidade, type SituacaoDuplicidade } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteDialogo, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { pode } from '../../../casca/sessao/pode.js';
import { atualizarFila, decidirOutraPessoa, lerFila, unificarPar } from '../api-cadastro.js';
import PaginacaoCadastro from '../componentes/PaginacaoCadastro.vue';
import { carimboBr, dataBr } from '../formato.js';

const { t } = useI18n();
const situacao = ref<SituacaoDuplicidade>('aberto');
const pagina = ref(1);
watch(situacao, () => (pagina.value = 1));

const fila = useQuery({
  queryKey: computed(() => ['cadastro', 'duplicidades', situacao.value, pagina.value]),
  queryFn: () => lerFila(situacao.value, pagina.value),
});
const f = computed(() => fila.data.value);
const podeDecidir = computed(() => pode('cadastro.duplicidade.decidir'));

const opcoesSituacao = computed(() =>
  SITUACOES_DUPLICIDADE.map((v) => ({ valor: v, rotulo: t(`cadastro.duplicidades.situacoes.${v}`) })),
);

const mensagem = ref<string | null>(null);
const erro = ref<unknown>(null);
async function atualizar(): Promise<void> {
  mensagem.value = null;
  erro.value = null;
  try {
    const r = await atualizarFila();
    mensagem.value = t('cadastro.duplicidades.atualizada', { novos: r.novos });
    await fila.refetch();
  } catch (e) {
    erro.value = e;
  }
}

// ── comparação lado a lado ──
const par = ref<ParDuplicidade | null>(null);
const aberto = ref(false);
const justificativa = ref('');
const erroDecisao = ref<unknown>(null);
function comparar(p: ParDuplicidade): void {
  par.value = p;
  justificativa.value = '';
  erroDecisao.value = null;
  unificando.value = false;
  aberto.value = true;
}
async function outraPessoa(): Promise<void> {
  if (!par.value) return;
  erroDecisao.value = null;
  try {
    await decidirOutraPessoa(par.value.id, justificativa.value.trim());
    aberto.value = false;
    mensagem.value = t('cadastro.duplicidades.decidido');
    await fila.refetch();
  } catch (e) {
    erroDecisao.value = e;
  }
}

// ── unificação (M57.2) ──
const unificando = ref(false);
const fica = ref<'a' | 'b'>('a');
const justificativaUnificar = ref('');
const senha = ref('');
const erroUnificar = ref<unknown>(null);
const podeUnificar = computed(() => !!f.value?.unificacao.disponivel);
function iniciarUnificacao(): void {
  unificando.value = true;
  fica.value = 'a';
  justificativaUnificar.value = '';
  senha.value = '';
  erroUnificar.value = null;
}
async function unificar(): Promise<void> {
  if (!par.value) return;
  erroUnificar.value = null;
  try {
    const r = await unificarPar(par.value.id, {
      fica: fica.value,
      justificativa: justificativaUnificar.value.trim(),
      ...(senha.value ? { senha: senha.value } : {}),
    });
    const prontuarioDe = (id: number) =>
      par.value?.a.id === id ? par.value.a.prontuario : (par.value?.b.prontuario ?? id);
    aberto.value = false;
    unificando.value = false;
    mensagem.value = t('cadastro.duplicidades.unificacao.feito', {
      absorvido: prontuarioDe(r.idAbsorvido),
      fica: prontuarioDe(r.idSobrevivente),
    });
    await fila.refetch();
  } catch (e) {
    erroUnificar.value = e;
  }
}

const criterios = (p: ParDuplicidade) =>
  p.criterios.map((c) => t(`cadastro.duplicidades.criteriosNomes.${c}`)).join(', ');
const linhas = computed(() => [
  { rotulo: t('cadastro.busca.prontuario'), campo: 'prontuario' as const },
  { rotulo: t('cadastro.busca.nome'), campo: 'nome' as const },
  { rotulo: t('cadastro.busca.nascimento'), campo: 'nascimento' as const },
  { rotulo: t('cadastro.busca.mae'), campo: 'mae' as const },
  { rotulo: t('cadastro.busca.cpf'), campo: 'cpfMascarado' as const },
  { rotulo: t('cadastro.busca.telefone'), campo: 'telefoneMascarado' as const },
  { rotulo: t('cadastro.ficha.cidade'), campo: 'cidade' as const },
  { rotulo: t('cadastro.busca.situacao'), campo: 'situacao' as const },
]);
function valor(l: ParDuplicidade['a'], campo: (typeof linhas.value)[number]['campo']): string {
  if (campo === 'nascimento') return dataBr(l.nascimento);
  if (campo === 'situacao') return t(`cadastro.situacoes.${l.situacao}`);
  const v = l[campo];
  return v === null ? '' : String(v);
}
</script>

<template>
  <section class="tela" aria-labelledby="duplicidades-titulo" data-testid="tela-duplicidades">
    <h1 id="duplicidades-titulo">{{ t('cadastro.duplicidades.titulo') }}</h1>
    <p>{{ t('cadastro.duplicidades.texto') }}</p>
    <SanteAlerta v-if="f" :texto="f.unificacao.motivo" variante="info" data-testid="unificacao-motivo" />
    <div class="barra">
      <SanteSelecao
        v-model="situacao"
        :rotulo="t('cadastro.duplicidades.situacao')"
        :opcoes="opcoesSituacao"
      />
      <SanteBotao
        v-if="podeDecidir"
        :rotulo="t('cadastro.duplicidades.atualizar')"
        variante="secundario"
        data-testid="botao-atualizar-fila"
        @acionar="atualizar"
      />
    </div>
    <p v-if="mensagem" role="status" data-testid="mensagem-fila">{{ mensagem }}</p>
    <MensagemErro v-if="erro" :erro="erro" />
    <MensagemErro v-if="fila.isError.value" :erro="fila.error.value" />
    <p v-else-if="!f">{{ t('cadastro.carregando') }}</p>
    <template v-else>
      <p v-if="f.itens.length === 0">{{ t('cadastro.duplicidades.nenhum') }}</p>
      <table v-else data-testid="tabela-duplicidades">
        <caption>
          {{
            t('cadastro.duplicidades.legenda', { n: f.total })
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('cadastro.duplicidades.a') }}</th>
            <th scope="col">{{ t('cadastro.duplicidades.b') }}</th>
            <th scope="col">{{ t('cadastro.duplicidades.escore') }}</th>
            <th scope="col">{{ t('cadastro.duplicidades.criterios') }}</th>
            <th scope="col">{{ t('cadastro.duplicidades.situacao') }}</th>
            <th scope="col">
              <span class="oculto">{{ t('cadastro.duplicidades.comparar') }}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in f.itens" :key="p.id" :data-testid="`par-${p.id}`">
            <td>{{ p.a.prontuario }} · {{ p.a.nome }}</td>
            <td>{{ p.b.prontuario }} · {{ p.b.nome }}</td>
            <td>{{ p.escore }}</td>
            <td>{{ criterios(p) }}</td>
            <td>
              {{ t(`cadastro.duplicidades.situacoes.${p.situacao}`) }}
              <span v-if="p.decididoPor" class="pequeno">
                {{
                  t('cadastro.duplicidades.decididoPor', { quem: p.decididoPor, em: carimboBr(p.decididoEm) })
                }}
              </span>
            </td>
            <td>
              <SanteBotao
                :rotulo="t('cadastro.duplicidades.comparar')"
                variante="texto"
                :data-testid="`comparar-${p.id}`"
                @acionar="comparar(p)"
              />
            </td>
          </tr>
        </tbody>
      </table>
      <PaginacaoCadastro
        v-model="pagina"
        :total="f.total"
        :por-pagina="25"
        :rotulo="t('cadastro.duplicidades.titulo')"
      />
    </template>

    <SanteDialogo v-model:visivel="aberto" :titulo="t('cadastro.duplicidades.comparar')" largura="52rem">
      <div v-if="par" data-testid="comparacao">
        <table>
          <caption>
            {{
              t('cadastro.duplicidades.escore')
            }}:
            {{
              par.escore
            }}
            ({{
              criterios(par)
            }})
          </caption>
          <thead>
            <tr>
              <th scope="col"></th>
              <th scope="col">{{ t('cadastro.duplicidades.a') }}</th>
              <th scope="col">{{ t('cadastro.duplicidades.b') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="l in linhas"
              :key="l.campo"
              :class="{ igual: valor(par.a, l.campo) === valor(par.b, l.campo) }"
            >
              <th scope="row">{{ l.rotulo }}</th>
              <td>{{ valor(par.a, l.campo) }}</td>
              <td>{{ valor(par.b, l.campo) }}</td>
            </tr>
          </tbody>
        </table>
        <p class="acoes">
          <RouterLink :to="`/cadastros/pacientes/${par.a.id}`">{{ t('cadastro.duplicidades.a') }}</RouterLink>
          <RouterLink :to="`/cadastros/pacientes/${par.b.id}`">{{ t('cadastro.duplicidades.b') }}</RouterLink>
        </p>
        <form
          v-if="podeDecidir && par.situacao === 'aberto'"
          class="form"
          data-testid="form-decisao"
          @submit.prevent="outraPessoa"
        >
          <MensagemErro v-if="erroDecisao" :erro="erroDecisao" />
          <label for="justificativa">{{ t('cadastro.duplicidades.justificativa') }}</label>
          <textarea
            id="justificativa"
            v-model="justificativa"
            maxlength="200"
            rows="2"
            required
            data-testid="justificativa"
          />
          <div class="acoes">
            <SanteBotao
              :rotulo="t('cadastro.duplicidades.outraPessoa')"
              variante="primario"
              tipo="submit"
              :desabilitado="justificativa.trim().length < 5"
              data-testid="botao-outra-pessoa"
            />
            <SanteBotao
              :rotulo="t('cadastro.duplicidades.unificar')"
              variante="secundario"
              :desabilitado="!podeUnificar"
              data-testid="botao-unificar"
              @acionar="iniciarUnificacao"
            />
            <SanteBotao
              :rotulo="t('cadastro.duplicidades.fechar')"
              variante="texto"
              @acionar="aberto = false"
            />
          </div>
        </form>
        <p v-if="podeDecidir && par.situacao === 'aberto' && !podeUnificar" class="pequeno">
          {{ f?.unificacao.motivo }}
        </p>
        <form
          v-if="unificando && par.situacao === 'aberto'"
          class="form"
          data-testid="form-unificar"
          @submit.prevent="unificar"
        >
          <h2>{{ t('cadastro.duplicidades.unificacao.titulo') }}</h2>
          <p>{{ t('cadastro.duplicidades.unificacao.texto') }}</p>
          <fieldset>
            <legend>{{ t('cadastro.duplicidades.unificacao.fica') }}</legend>
            <label>
              <input v-model="fica" type="radio" value="a" data-testid="fica-a" />
              {{ t('cadastro.duplicidades.unificacao.ficaA', { prontuario: par.a.prontuario }) }}
            </label>
            <label>
              <input v-model="fica" type="radio" value="b" data-testid="fica-b" />
              {{ t('cadastro.duplicidades.unificacao.ficaB', { prontuario: par.b.prontuario }) }}
            </label>
          </fieldset>
          <label for="justificativa-unificar">{{
            t('cadastro.duplicidades.unificacao.justificativa')
          }}</label>
          <textarea
            id="justificativa-unificar"
            v-model="justificativaUnificar"
            maxlength="200"
            rows="2"
            required
            data-testid="justificativa-unificar"
          />
          <label for="senha-unificar">{{ t('cadastro.duplicidades.unificacao.senha') }}</label>
          <input
            id="senha-unificar"
            v-model="senha"
            type="password"
            autocomplete="current-password"
            data-testid="senha-unificar"
          />
          <MensagemErro v-if="erroUnificar" :erro="erroUnificar" />
          <SanteBotao
            tipo="submit"
            variante="primario"
            :rotulo="t('cadastro.duplicidades.unificacao.confirmar')"
            :desabilitado="justificativaUnificar.trim().length < 5"
            data-testid="botao-confirmar-unificar"
          />
        </form>
      </div>
    </SanteDialogo>
  </section>
</template>

<style scoped>
/* Alvo mínimo de toque (WCAG 2.5.8): links de ação e de lista. */
nav a,
.acoes a,
li a,
.link-acao {
  display: inline-flex;
  align-items: center;
  min-height: var(--sgh-alvo-minimo);
}

table {
  border-collapse: collapse;
  width: 100%;
}
th,
td {
  text-align: left;
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2);
  border-bottom: 1px solid var(--sgh-borda);
}
tr.igual td {
  font-weight: 600;
}
.barra,
.acoes {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: end;
  margin: var(--sgh-espaco-2) 0;
}
.form {
  display: grid;
  gap: var(--sgh-espaco-1);
}
.pequeno {
  display: block;
  font-size: var(--sgh-fonte-pequena);
}
.oculto {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}
fieldset {
  border: 1px solid var(--sgh-borda);
  display: grid;
  gap: var(--sgh-espaco-1);
}
fieldset label {
  display: inline-flex;
  gap: var(--sgh-espaco-1);
  align-items: center;
  min-height: var(--sgh-alvo-minimo);
}
input[type='password'],
textarea {
  font: inherit;
  padding: var(--sgh-espaco-1);
  border: 1px solid var(--sgh-borda-forte);
  background: var(--sgh-fundo);
  color: var(--sgh-texto);
}
</style>
