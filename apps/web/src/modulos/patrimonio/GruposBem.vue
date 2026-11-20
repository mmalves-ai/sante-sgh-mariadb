<script setup lang="ts">
// W0-08: o grupo do bem como cadastro do estabelecimento (partindo dos 8 grupos da IN RFB 1.700/2017): incluir; alterar
// nome, vida útil e conta pela versão lida, com motivo (a vida útil nova vale só para as cotas seguintes: as já
// calculadas não mudam); inativar e reativar com motivo; excluir só o nunca usado (com bens, o servidor recusa com a
// contagem e a tela oferece a inativação). As versões anteriores ficam visíveis. A tela confere pelo esquema do
// servidor; as gravações exigem `patrimonio.bem.cadastrar` e a liberação ligada (o servidor confere de novo).
import {
  esquemaAlterarGrupoBem,
  esquemaIncluirGrupoBem,
  esquemaMotivoGrupoBem,
  type ApoioPatrimonio,
  type GrupoBemCadastro,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { problemasDe } from '../manutencao/comum-manutencao.js';
import { dependentesDaRecusa } from '../manutencao/api-manutencao.js';
import { alterarGrupo, incluirGrupo, lerGrupo, lerGrupos, situacaoGrupo } from './api-patrimonio.js';
import { instante } from './comum-patrimonio.js';
import ErroPatrimonio from './ErroPatrimonio.vue';

type Modo = 'incluir' | 'alterar' | 'inativar' | 'reativar' | 'excluir';
const props = defineProps<{ apoio: ApoioPatrimonio }>();
const { t } = useI18n();
const cliente = useQueryClient();
const pode = computed(() => props.apoio.acoes.cadastrar && props.apoio.liberacao.ligada);

const lista = useQuery({ queryKey: ['patrimonio', 'grupos'], queryFn: lerGrupos });
const grupos = computed(() => lista.data.value?.grupos ?? []);
// Revisão W0-08: a conta do grupo é uma conta analítica e ativa do plano (combo com busca; o servidor confere de novo).
// A conta que o grupo já tem e que saiu do plano continua escolhida, marcada, até ser trocada.
const opcoesConta = computed(() => {
  const contas = lista.data.value?.contas ?? [];
  const ops = [
    { valor: null as string | null, rotulo: '—' },
    ...contas.map((c) => ({ valor: c.codigo as string | null, rotulo: `${c.codigo} ${c.nome}` })),
  ];
  const atualConta = conta.value;
  if (atualConta && !contas.some((c) => c.codigo === atualConta))
    ops.push({ valor: atualConta, rotulo: `${atualConta} (${t('patrimonio.gruposBem.contaForaDoPlano')})` });
  return ops;
});

const modo = ref<Modo | null>(null);
const escolhido = ref<string | null>(null);
const detalhe = useQuery({
  queryKey: computed(() => ['patrimonio', 'grupo', escolhido.value]),
  queryFn: () => lerGrupo(escolhido.value as string),
  enabled: computed(() => escolhido.value !== null),
});
const atual = computed(() => (escolhido.value ? (detalhe.data.value ?? null) : null));

const codigo = ref('');
const nome = ref('');
const vida = ref('');
const conta = ref<string | null>(null);
const motivo = ref('');
const problemas = ref<Record<string, string>>({});
const listaProblemas = computed(() => Object.values(problemas.value));
const erro = ref<unknown>(null);
const dependentes = computed(() => dependentesDaRecusa(erro.value));
const gravando = ref(false);
const aviso = ref<string | null>(null);

function abrir(m: Modo, g: GrupoBemCadastro | null) {
  modo.value = m;
  escolhido.value = g?.codigo ?? null;
  codigo.value = '';
  nome.value = g?.nome ?? '';
  vida.value = g ? String(g.vidaUtilMeses) : '';
  conta.value = g?.conta ?? null;
  motivo.value = '';
  problemas.value = {};
  erro.value = null;
  aviso.value = null;
}
function fechar() {
  modo.value = null;
  escolhido.value = null;
}

const vidaNumero = () => (/^\d{1,4}$/.test(vida.value.trim()) ? Number(vida.value.trim()) : vida.value);
const contaOuNulo = () => conta.value;

async function gravar() {
  const m = modo.value;
  if (!m) return;
  erro.value = null;
  const campos = { nome: nome.value.trim(), vidaUtilMeses: vidaNumero(), conta: contaOuNulo() };
  let feito: () => Promise<unknown>;
  if (m === 'incluir') {
    const b = { codigo: codigo.value.trim(), ...campos };
    problemas.value = problemasDe(esquemaIncluirGrupoBem, b);
    feito = () => incluirGrupo(b as never);
  } else {
    const g = atual.value;
    if (!g) return;
    if (m === 'alterar') {
      const b = { versao: g.versao, ...campos, motivo: motivo.value.trim() };
      problemas.value = problemasDe(esquemaAlterarGrupoBem, b);
      feito = () => alterarGrupo(g.codigo, b as never);
    } else {
      const b = { versao: g.versao, motivo: motivo.value.trim() };
      problemas.value = problemasDe(esquemaMotivoGrupoBem, b);
      const acao = m === 'inativar' ? 'inativacao' : m === 'reativar' ? 'reativacao' : 'exclusao';
      feito = () => situacaoGrupo(g.codigo, acao, b);
    }
  }
  if (Object.keys(problemas.value).length > 0) return;
  gravando.value = true;
  try {
    await feito();
    const rotulo = m === 'incluir' ? codigo.value.trim() : (atual.value?.nome ?? '');
    fechar();
    aviso.value = t(`patrimonio.gruposBem.gravado.${m}`, { nome: rotulo });
    await cliente.invalidateQueries({ queryKey: ['patrimonio'] });
  } catch (e) {
    erro.value = e;
  } finally {
    gravando.value = false;
  }
}

function inativarEmVez() {
  erro.value = null;
  modo.value = 'inativar';
}
</script>

<template>
  <section class="bloco" aria-labelledby="grupos-bem-titulo" data-testid="grupos-bem">
    <h2 id="grupos-bem-titulo">{{ t('patrimonio.gruposBem.titulo') }}</h2>
    <p class="secundario">{{ t('patrimonio.gruposBem.ajuda') }}</p>
    <SanteAlerta v-if="!apoio.liberacao.ligada" variante="info" :texto="t('patrimonio.desligado')" />
    <div v-if="aviso" role="status" data-testid="grupos-bem-aviso">
      <SanteAlerta variante="info" :texto="aviso" />
    </div>
    <ErroPatrimonio v-if="lista.isError.value" :erro="lista.error.value" />
    <p v-else-if="lista.isPending.value" role="status">{{ t('patrimonio.carregando') }}</p>
    <template v-else>
      <div v-if="pode && modo === null" class="acoes">
        <SanteBotao
          :rotulo="t('patrimonio.gruposBem.incluir')"
          data-testid="grupo-incluir"
          @acionar="abrir('incluir', null)"
        />
      </div>
      <table class="tabela" data-testid="grupos-bem-tabela">
        <thead>
          <tr>
            <th scope="col">{{ t('patrimonio.gruposBem.campos.codigo') }}</th>
            <th scope="col">{{ t('patrimonio.gruposBem.campos.nome') }}</th>
            <th scope="col">{{ t('patrimonio.gruposBem.campos.vidaUtil') }}</th>
            <th scope="col">{{ t('patrimonio.gruposBem.campos.conta') }}</th>
            <th scope="col">{{ t('patrimonio.gruposBem.campos.situacao') }}</th>
            <th scope="col">{{ t('patrimonio.gruposBem.campos.bens') }}</th>
            <th v-if="pode" scope="col">{{ t('patrimonio.acoes') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="g in grupos" :key="g.codigo" :data-testid="`grupo-${g.codigo}`">
            <td>{{ g.codigo }}</td>
            <td>{{ g.nome }}</td>
            <td>{{ t('patrimonio.gruposBem.meses', { n: g.vidaUtilMeses }) }}</td>
            <td>{{ g.conta ?? '-' }}</td>
            <td>
              {{ g.ativo ? t('patrimonio.gruposBem.ativo') : t('patrimonio.gruposBem.inativo') }}
              <span v-if="!g.ativo && g.motivoInativacao" class="secundario">({{ g.motivoInativacao }})</span>
            </td>
            <td>{{ g.bens }}</td>
            <td v-if="pode" class="acoes">
              <SanteBotao
                variante="texto"
                :rotulo="t('patrimonio.gruposBem.alterar')"
                :data-testid="`grupo-alterar-${g.codigo}`"
                @acionar="abrir('alterar', g)"
              />
              <SanteBotao
                variante="texto"
                :rotulo="g.ativo ? t('patrimonio.gruposBem.inativar') : t('patrimonio.gruposBem.reativar')"
                :data-testid="`grupo-${g.ativo ? 'inativar' : 'reativar'}-${g.codigo}`"
                @acionar="abrir(g.ativo ? 'inativar' : 'reativar', g)"
              />
              <SanteBotao
                variante="texto"
                :rotulo="t('patrimonio.gruposBem.excluir')"
                :data-testid="`grupo-excluir-${g.codigo}`"
                @acionar="abrir('excluir', g)"
              />
            </td>
          </tr>
        </tbody>
      </table>

      <section v-if="modo" class="bloco" :data-testid="`grupo-form-${modo}`">
        <h3>
          {{ t(`patrimonio.gruposBem.titulos.${modo}`, { nome: atual?.nome ?? '' }) }}
        </h3>
        <SanteAlerta variante="info" :texto="t(`patrimonio.gruposBem.ajudas.${modo}`)" />
        <p v-if="modo !== 'incluir' && !atual" role="status">{{ t('patrimonio.carregando') }}</p>
        <form v-else data-testid="grupo-form" @submit.prevent="gravar">
          <div v-if="modo === 'incluir' || modo === 'alterar'" class="campos">
            <SanteCampoTexto
              v-if="modo === 'incluir'"
              v-model="codigo"
              obrigatorio
              :rotulo="t('patrimonio.gruposBem.campos.codigo')"
              :max-bytes="20"
              data-testid="grupo-codigo"
            />
            <SanteCampoTexto
              v-model="nome"
              obrigatorio
              :rotulo="t('patrimonio.gruposBem.campos.nome')"
              :max-bytes="80"
              data-testid="grupo-nome"
            />
            <SanteCampoTexto
              v-model="vida"
              obrigatorio
              :rotulo="t('patrimonio.gruposBem.campos.vidaUtil')"
              :max-bytes="4"
              data-testid="grupo-vida"
            />
            <SanteSelecao
              v-model="conta"
              :rotulo="t('patrimonio.gruposBem.campos.conta')"
              :opcoes="opcoesConta"
              busca
              data-testid="grupo-conta"
            />
          </div>
          <SanteCampoTexto
            v-if="modo !== 'incluir'"
            v-model="motivo"
            multilinha
            obrigatorio
            :rotulo="t('patrimonio.gruposBem.motivo')"
            :max-bytes="400"
            data-testid="grupo-motivo"
          />
          <ul v-if="listaProblemas.length > 0" class="vencido" role="alert" data-testid="grupo-problemas">
            <li v-for="x in listaProblemas" :key="x">{{ x }}</li>
          </ul>
          <ErroPatrimonio v-if="erro" :erro="erro" />
          <div v-if="dependentes.length > 0" class="bloco" data-testid="grupo-dependentes">
            <p>{{ t('patrimonio.gruposBem.dependentes') }}</p>
            <ul>
              <li v-for="d in dependentes" :key="d.rotulo">{{ d.rotulo }}: {{ d.quantidade }}</li>
            </ul>
            <SanteBotao
              v-if="atual?.ativo"
              variante="secundario"
              :rotulo="t('patrimonio.gruposBem.inativarEmVez')"
              data-testid="grupo-inativar-em-vez"
              @acionar="inativarEmVez"
            />
          </div>
          <div class="acoes">
            <SanteBotao
              v-if="modo === 'excluir'"
              variante="destrutivo"
              :rotulo="t('patrimonio.gruposBem.gravar.excluir')"
              :confirmacao="t('patrimonio.gruposBem.confirmarExcluir', { nome: atual?.nome ?? '' })"
              :desabilitado="gravando"
              data-testid="grupo-gravar"
              @acionar="gravar"
            />
            <SanteBotao
              v-else
              tipo="submit"
              :rotulo="t(`patrimonio.gruposBem.gravar.${modo}`)"
              :desabilitado="gravando"
              data-testid="grupo-gravar"
            />
            <SanteBotao
              variante="texto"
              :rotulo="t('patrimonio.gruposBem.cancelar')"
              data-testid="grupo-cancelar"
              @acionar="fechar"
            />
          </div>
        </form>
        <template v-if="atual">
          <h4>{{ t('patrimonio.gruposBem.versoes') }}</h4>
          <p v-if="atual.versoes.length === 0">{{ t('patrimonio.gruposBem.nenhumaVersao') }}</p>
          <ul v-else class="historico" data-testid="grupo-versoes">
            <li v-for="v in atual.versoes" :key="v.versao" :data-testid="`grupo-versao-${v.versao}`">
              {{ t('patrimonio.gruposBem.versao', { versao: v.versao }) }}
              ({{ t(`patrimonio.gruposBem.operacao.${v.operacao}`) }}): {{ v.nome }} -
              {{ t('patrimonio.gruposBem.meses', { n: v.vidaUtilMeses }) }}
              <template v-if="v.conta"> - {{ v.conta }}</template>
              ({{ t('patrimonio.gruposBem.motivoDe') }}: {{ v.motivo }} - {{ v.por }}, {{ instante(v.em) }})
            </li>
          </ul>
        </template>
      </section>
    </template>
  </section>
</template>

<style scoped src="./estilo-patrimonio.css"></style>
