<script setup lang="ts">
// Médicos solicitantes externos (M11): consulta pelo nome ou pelo registro (conselho + UF + número, a busca da
// guia TISS; ficha §4); conselho, UF, número e CBO (a guia TISS exige), os repetidos por conselho + UF + número
// (candidatos a duplicidade, regra 12) e os incompletos. Revisão do M39 (onda 1, campo 7): a inclusão do solicitante
// externo, com a permissão `cadastro.solicitante.criar` (pelo executor; o mesmo conselho, UF e número não entra duas
// vezes; a recusa do servidor aparece com o motivo).
import { tipoDoProblema } from '@sgh/contratos';
import { SanteAlerta, SanteBotao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { ErroApi } from '../../../casca/erros/problem-details.js';
import { pode } from '../../../casca/sessao/pode.js';
import { buscarSolicitantes, incluirSolicitante } from '../api-cadastro.js';
import { lerParecidos, type Parecido } from '../api-ligacoes.js';

const { t } = useI18n();
const termo = ref('');
const conselho = ref('');
const uf = ref('');
const numero = ref('');
type Pedido = string | { conselho: string; uf: string; numero: string };
const pedido = ref<Pedido | null>(null);
const consulta = useQuery({
  queryKey: computed(() => ['cadastro', 'solicitantes', pedido.value]),
  queryFn: () => buscarSolicitantes(pedido.value!),
  enabled: computed(() => pedido.value !== null),
});
const r = computed(() => consulta.data.value);
function buscar(): void {
  const x = termo.value.trim();
  if (x) pedido.value = x;
}
// ── Inclusão (revisão do M39) ──
const cliente = useQueryClient();
const podeIncluir = computed(() => pode('cadastro.solicitante.criar'));
const novo = ref({ nome: '', conselho: 'CRM', uf: '', numero: '' });
const gravando = ref(false);
const erroInclusao = ref<unknown>(null);
/** A recusa do servidor (repetido, conselho inexistente, gravação não liberada) com o motivo dele. */
const recusaInclusao = ref<string | null>(null);
// F3.1 (02-CAD linha 20): parecidos pela regra do domínio, na hora (antes de gravar), sem bloquear a inclusão.
const parecidosNovo = ref<Parecido[]>([]);
async function conferirParecidos(): Promise<void> {
  const x = novo.value;
  if (x.nome.trim().length < 5 && !x.numero.trim()) return void (parecidosNovo.value = []);
  try {
    parecidosNovo.value = await lerParecidos({
      nome: x.nome,
      conselho: x.conselho,
      uf: x.uf,
      numero: x.numero,
    });
  } catch {
    parecidosNovo.value = [];
  }
}
const incluido = ref<string | null>(null);
async function incluir(): Promise<void> {
  if (gravando.value) return;
  gravando.value = true;
  erroInclusao.value = null;
  recusaInclusao.value = null;
  incluido.value = null;
  try {
    const nome = novo.value.nome.trim().toUpperCase();
    await incluirSolicitante({
      nome,
      conselho: novo.value.conselho.trim().toUpperCase(),
      uf: novo.value.uf.trim().toUpperCase(),
      numero: Number(novo.value.numero.replace(/\D+/g, '')),
    });
    incluido.value = nome;
    novo.value = { nome: '', conselho: 'CRM', uf: '', numero: '' };
    await cliente.invalidateQueries({ queryKey: ['cadastro', 'solicitantes'] });
  } catch (e) {
    const tipo = e instanceof ErroApi && e.problema ? tipoDoProblema(e.problema) : null;
    if ((tipo === 'recusa-de-negocio' || tipo === 'entrada-invalida') && e instanceof ErroApi && e.problema)
      recusaInclusao.value = e.problema.detail ?? e.problema.title ?? '';
    else erroInclusao.value = e;
  } finally {
    gravando.value = false;
  }
}

function buscarRegistro(): void {
  const n = numero.value.replace(/\D+/g, '');
  if (!n) return;
  pedido.value = {
    conselho: conselho.value.trim().toUpperCase(),
    uf: uf.value.trim().toUpperCase(),
    numero: n,
  };
}
</script>

<template>
  <section class="tela" aria-labelledby="solicitantes-titulo" data-testid="tela-solicitantes">
    <h1 id="solicitantes-titulo">{{ t('cadastro.solicitantes.titulo') }}</h1>
    <p>{{ t('cadastro.solicitantes.texto') }}</p>
    <form class="barra" role="search" @submit.prevent="buscar">
      <div class="campo">
        <label for="termo-solicitante">{{ t('cadastro.solicitantes.termo') }}</label>
        <input
          id="termo-solicitante"
          v-model="termo"
          type="search"
          maxlength="70"
          data-testid="termo-solicitante"
        />
      </div>
      <SanteBotao :rotulo="t('cadastro.profissionais.buscar')" variante="primario" tipo="submit" />
    </form>
    <form
      class="barra"
      role="search"
      :aria-label="t('cadastro.solicitantes.porRegistro')"
      data-testid="form-registro-solicitante"
      @submit.prevent="buscarRegistro"
    >
      <div class="campo">
        <label for="conselho-solicitante">{{ t('cadastro.solicitantes.siglaConselho') }}</label>
        <input
          id="conselho-solicitante"
          v-model="conselho"
          class="curto"
          maxlength="8"
          autocomplete="off"
          data-testid="conselho-solicitante"
        />
      </div>
      <div class="campo">
        <label for="uf-solicitante">{{ t('cadastro.solicitantes.uf') }}</label>
        <input
          id="uf-solicitante"
          v-model="uf"
          class="curto"
          maxlength="2"
          autocomplete="off"
          data-testid="uf-solicitante"
        />
      </div>
      <div class="campo">
        <label for="numero-solicitante">{{ t('cadastro.solicitantes.numero') }}</label>
        <input
          id="numero-solicitante"
          v-model="numero"
          class="curto"
          inputmode="numeric"
          maxlength="9"
          data-testid="numero-solicitante"
        />
      </div>
      <SanteBotao
        :rotulo="t('cadastro.profissionais.buscar')"
        variante="secundario"
        tipo="submit"
        data-testid="buscar-registro-solicitante"
      />
    </form>
    <section
      v-if="podeIncluir"
      class="inclusao"
      aria-labelledby="incluir-solicitante-titulo"
      data-testid="incluir-solicitante"
    >
      <h2 id="incluir-solicitante-titulo">{{ t('cadastro.solicitantes.incluir') }}</h2>
      <p>{{ t('cadastro.solicitantes.incluirTexto') }}</p>
      <form class="barra" @submit.prevent="incluir">
        <div class="campo">
          <label for="novo-solicitante-nome">{{ t('cadastro.solicitantes.nomeCompleto') }}</label>
          <input
            id="novo-solicitante-nome"
            v-model="novo.nome"
            @blur="conferirParecidos"
            maxlength="70"
            minlength="5"
            required
            autocomplete="off"
            data-testid="novo-solicitante-nome"
          />
        </div>
        <div class="campo">
          <label for="novo-solicitante-conselho">{{ t('cadastro.solicitantes.siglaConselho') }}</label>
          <input
            id="novo-solicitante-conselho"
            v-model="novo.conselho"
            class="curto"
            maxlength="8"
            required
            autocomplete="off"
            data-testid="novo-solicitante-conselho"
          />
        </div>
        <div class="campo">
          <label for="novo-solicitante-uf">{{ t('cadastro.solicitantes.uf') }}</label>
          <input
            id="novo-solicitante-uf"
            v-model="novo.uf"
            class="curto"
            maxlength="2"
            required
            autocomplete="off"
            data-testid="novo-solicitante-uf"
          />
        </div>
        <div class="campo">
          <label for="novo-solicitante-numero">{{ t('cadastro.solicitantes.numero') }}</label>
          <input
            id="novo-solicitante-numero"
            v-model="novo.numero"
            @blur="conferirParecidos"
            class="curto"
            inputmode="numeric"
            maxlength="9"
            required
            data-testid="novo-solicitante-numero"
          />
        </div>
        <SanteBotao
          :rotulo="t('cadastro.solicitantes.gravar')"
          variante="primario"
          tipo="submit"
          :desabilitado="gravando"
          data-testid="gravar-solicitante"
        />
      </form>
      <SanteAlerta
        v-if="recusaInclusao"
        :texto="recusaInclusao"
        variante="aviso"
        anunciar
        data-testid="recusa-solicitante"
      />
      <div v-if="parecidosNovo.length" class="aviso" role="status" data-testid="parecidos-solicitante">
        <p>{{ t('ligacoes.solicitante.avisoParecidos') }}</p>
        <ul>
          <li v-for="p in parecidosNovo" :key="p.id">
            <RouterLink :to="`/cadastros/solicitantes/${p.id}`">{{ p.nome }}</RouterLink>
            — {{ p.registro }} ({{ t(`ligacoes.solicitante.motivos.${p.motivo}`) }})
          </li>
        </ul>
      </div>
      <MensagemErro v-if="erroInclusao" :erro="erroInclusao" />
      <p v-if="incluido" role="status" data-testid="solicitante-incluido">
        {{ t('cadastro.solicitantes.incluido', { nome: incluido }) }}
      </p>
    </section>
    <MensagemErro v-if="consulta.isError.value" :erro="consulta.error.value" />
    <template v-else-if="r">
      <p v-if="r.truncado" role="status">{{ t('cadastro.solicitantes.truncado') }}</p>
      <p v-if="r.itens.length === 0" role="status">{{ t('cadastro.nenhum') }}</p>
      <table v-else data-testid="tabela-solicitantes">
        <caption>
          {{
            t('cadastro.solicitantes.legenda', { n: r.itens.length })
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('cadastro.solicitantes.nome') }}</th>
            <th scope="col">{{ t('cadastro.solicitantes.conselho') }}</th>
            <th scope="col">{{ t('cadastro.solicitantes.cbo') }}</th>
            <th scope="col">{{ t('cadastro.solicitantes.codigos') }}</th>
            <th scope="col">{{ t('cadastro.busca.situacao') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="s in r.itens" :key="s.id">
            <td>
              <RouterLink :to="`/cadastros/solicitantes/${s.id}`">{{ s.nome }}</RouterLink>
            </td>
            <td>
              {{ [s.conselho, s.numero, s.uf].filter((x) => x !== null && x !== '').join(' ')
              }}<template v-if="s.conselho && !s.uf">
                ({{ t('ligacoes.solicitante.ufNaoInformada', 'UF não informada na origem') }})</template
              >
            </td>
            <td>{{ s.cbo ?? '' }}</td>
            <td>{{ s.codigosConvenio }}</td>
            <td>
              <span v-if="s.duplicado" class="marca">{{ t('cadastro.solicitantes.duplicado') }}</span>
              <span v-if="s.incompleto" class="marca">{{ t('cadastro.solicitantes.incompleto') }}</span>
            </td>
          </tr>
        </tbody>
      </table>
    </template>
  </section>
</template>

<style scoped>
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
.barra {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: end;
  margin: var(--sgh-espaco-2) 0;
}
.inclusao {
  margin: var(--sgh-espaco-3) 0;
  padding: var(--sgh-espaco-2);
  border: 1px solid var(--sgh-borda);
}
.campo {
  display: grid;
  gap: var(--sgh-espaco-1);
}
.marca {
  display: inline-block;
  margin-right: var(--sgh-espaco-1);
  font-size: var(--sgh-fonte-pequena);
  outline: 1px solid var(--sgh-borda-forte);
  padding: 0 var(--sgh-espaco-1);
}
input {
  font: inherit;
  padding: var(--sgh-espaco-1);
  border: 1px solid var(--sgh-borda-forte);
  background: var(--sgh-fundo);
  color: var(--sgh-texto);
  min-width: 18rem;
}
input.curto {
  min-width: 6rem;
  width: 8rem;
}
</style>
