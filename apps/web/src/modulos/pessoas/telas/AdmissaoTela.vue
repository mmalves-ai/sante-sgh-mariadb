<script setup lang="ts">
// Admitir colaborador (M52.1; regra 1; `pessoas.colaborador.admitir`): (1) o CPF, que o servidor usa como filtro exato
// nos cadastros do hospital (profissional e usuário) e nos vínculos já registrados: a pessoa encontrada é reusada,
// nunca duplicada; (2) o vínculo e a lotação, com o teto da carga semanal por tipo de vínculo; (3) a confirmação. O
// mesmo Zod da API confere o formulário; o servidor relê tudo na transação.
import {
  CODIGOS_TIPO_VINCULO,
  esquemaAdmitirColaborador,
  esquemaCpf,
  GRAUS_INSTRUCAO,
  type PreviaAdmissao,
  TIPOS_VINCULO,
  type TipoVinculo,
} from '@sgh/contratos';
import { conferirFichaAdmissao, limiteCargaSemanal } from '@sgh/dominio-pessoas';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteData, SantePassos, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { admitir, consultarCpf, lerApoioPessoas } from '../api-pessoas.js';
import { dataBr } from '../comum.js';
import ErroPessoas from '../componentes/ErroPessoas.vue';

const { t } = useI18n();
const router = useRouter();
const cliente = useQueryClient();
const apoio = useQuery({ queryKey: ['pessoas', 'apoio'], queryFn: lerApoioPessoas });
const a = computed(() => apoio.data.value ?? null);

const passo = ref<'cpf' | 'vinculo' | 'confirmar'>('cpf');
const passos = computed(() => [
  { valor: 'cpf', rotulo: t('pessoas.admissao.passos.cpf') },
  { valor: 'vinculo', rotulo: t('pessoas.admissao.passos.vinculo') },
  { valor: 'confirmar', rotulo: t('pessoas.admissao.passos.confirmar') },
]);

// ── Passo 1: CPF e prévia ──
const cpf = ref('');
const cpfErro = ref<string | null>(null);
const previa = ref<PreviaAdmissao | null>(null);
const erro = ref<unknown>(null);
const ocupado = ref(false);
async function consultar(): Promise<void> {
  erro.value = null;
  cpfErro.value = null;
  previa.value = null;
  if (!esquemaCpf.safeParse(cpf.value).success) {
    cpfErro.value = t('pessoas.admissao.cpfInvalido');
    return;
  }
  ocupado.value = true;
  try {
    previa.value = await consultarCpf(cpf.value);
    if (previa.value.profissional && !nome.value) nome.value = previa.value.profissional.nome;
  } catch (e) {
    erro.value = e;
  } finally {
    ocupado.value = false;
  }
}

// ── Passo 2: vínculo ──
const nome = ref('');
const tipo = ref<TipoVinculo>('clt');
const admissao = ref<string | null>(null);
const cargo = ref('');
const funcao = ref('');
const carga = ref('44');
const centroCusto = ref<number | null>(null);
const unidade = ref<number | null>(null);
const setor = ref('');
const matricula = ref('');
// Ficha da admissão (C1-111; eSocial S-2200): o contrato de trabalho exige; a regra do domínio confere na hora.
const nascimento = ref<string | null>(null);
const sexo = ref<number | null>(null);
const grauInstrucao = ref<string | null>(null);
const categoria = ref<number | null>(null);
const tipoVinculoTrabalho = ref<number | null>(null);
const salario = ref('');
const salarioNumero = computed(() => {
  const t = salario.value.trim().replace(/\./g, '').replace(',', '.');
  return t === '' || Number.isNaN(Number(t)) ? null : Number(t);
});
const opcoesGrau = Object.entries(GRAUS_INSTRUCAO).map(([valor, rotulo]) => ({
  valor,
  rotulo: `${valor} - ${rotulo}`,
}));
const opcoesCatalogo = (xs: readonly { codigo: number; rotulo: string }[] | undefined) =>
  (xs ?? []).map((x) => ({ valor: x.codigo, rotulo: x.rotulo }));
const opcoesSexo = computed(() => opcoesCatalogo(a.value?.sexos));
const opcoesCategoria = computed(() => opcoesCatalogo(a.value?.categoriasTrabalhador));
const opcoesNatureza = computed(() => opcoesCatalogo(a.value?.tiposVinculoTrabalho));
const ficha = computed(() =>
  admissao.value
    ? conferirFichaAdmissao({
        nascimento: nascimento.value,
        admissao: admissao.value,
        grauInstrucao: grauInstrucao.value,
        salario: salarioNumero.value,
      })
    : null,
);
const fichaErro = computed(() => (ficha.value && !ficha.value.ok ? ficha.value.mensagem : null));
const fichaCompleta = computed(
  () =>
    ficha.value?.ok === true &&
    sexo.value !== null &&
    categoria.value !== null &&
    tipoVinculoTrabalho.value !== null &&
    matricula.value.trim() !== '',
);
const limite = computed(() => limiteCargaSemanal(tipo.value));
const opcoesTipo = CODIGOS_TIPO_VINCULO.map((c) => ({ valor: c, rotulo: TIPOS_VINCULO[c] }));
const opcoesCentro = computed(() =>
  (a.value?.centrosCusto ?? []).map((c) => ({ valor: c.codigo, rotulo: c.rotulo })),
);
const opcoesUnidade = computed(() => [
  { valor: null, rotulo: t('pessoas.admissao.semUnidade') },
  ...(a.value?.unidades ?? []).map((u) => ({ valor: u.codigo, rotulo: u.rotulo })),
]);
const entrada = computed(() =>
  esquemaAdmitirColaborador.safeParse({
    cpf: cpf.value,
    nome: nome.value.trim(),
    tipo: tipo.value,
    admissao: admissao.value ?? '',
    cargo: cargo.value.trim(),
    funcao: funcao.value.trim() || null,
    cargaSemanalHoras: Number(carga.value),
    lotacao: {
      centroCusto: centroCusto.value ?? 0,
      unidade: unidade.value,
      setor: setor.value.trim() || null,
    },
    matricula: matricula.value.trim() || null,
    profissional: previa.value?.profissional?.id ?? null,
    usuario: previa.value?.usuarios[0]?.id ?? null,
    nascimento: nascimento.value,
    sexo: sexo.value,
    grauInstrucao: grauInstrucao.value,
    categoria: categoria.value,
    tipoVinculoTrabalho: tipoVinculoTrabalho.value,
    salario: salarioNumero.value,
  }),
);
const camposInvalidos = computed(() =>
  entrada.value.success ? [] : [...new Set(entrada.value.error.issues.map((i) => i.message))],
);
const acimaDoLimite = computed(() => Number(carga.value) > limite.value);

// ── Passo 3: gravar ──
const admitido = ref<number | null>(null);
async function gravar(): Promise<void> {
  if (!entrada.value.success || acimaDoLimite.value || !fichaCompleta.value) return;
  erro.value = null;
  ocupado.value = true;
  try {
    const r = await admitir(entrada.value.data);
    admitido.value = r.id;
    await cliente.invalidateQueries({ queryKey: ['pessoas'] });
  } catch (e) {
    erro.value = e;
  } finally {
    ocupado.value = false;
  }
}
</script>

<template>
  <section class="tela-pessoas" aria-labelledby="pes-adm-titulo" data-testid="tela-admissao">
    <h1 id="pes-adm-titulo">{{ t('pessoas.admissao.titulo') }}</h1>
    <ErroPessoas v-if="apoio.isError.value" :erro="apoio.error.value" />
    <p v-else-if="!a" role="status">{{ t('pessoas.carregando') }}</p>
    <SanteAlerta
      v-else-if="!a.acoes.admitir"
      :texto="a.acoes.motivo ?? a.gravacao.motivo ?? t('pessoas.gravacaoDesligada')"
      variante="info"
      data-testid="admissao-desligada"
    />
    <template v-else>
      <SantePassos v-model="passo" :passos="passos" />

      <div v-if="admitido !== null" class="bloco" data-testid="admissao-concluida">
        <SanteAlerta :texto="t('pessoas.admissao.sucesso')" variante="info" anunciar />
        <SanteBotao
          :rotulo="t('pessoas.admissao.abrirFicha')"
          data-testid="abrir-ficha-admitido"
          @acionar="router.push(`/pessoas/colaboradores/${admitido}`)"
        />
      </div>

      <form v-else-if="passo === 'cpf'" class="bloco" @submit.prevent="consultar">
        <p>{{ t('pessoas.admissao.passoCpf') }}</p>
        <div class="campos">
          <SanteCampoTexto
            v-model="cpf"
            :rotulo="t('pessoas.admissao.cpf')"
            :max-bytes="14"
            obrigatorio
            data-testid="admissao-cpf"
          />
          <SanteBotao
            :rotulo="t('pessoas.admissao.consultar')"
            tipo="submit"
            variante="secundario"
            :desabilitado="ocupado"
            data-testid="consultar-cpf"
          />
        </div>
        <SanteAlerta v-if="cpfErro" :texto="cpfErro" variante="alerta" anunciar />
        <template v-if="previa">
          <div data-testid="previa-admissao" class="bloco">
            <SanteAlerta v-if="previa.ambigua" :texto="t('pessoas.admissao.ambigua')" variante="alerta" />
            <p v-if="!previa.profissional && previa.usuarios.length === 0">
              {{ t('pessoas.admissao.pessoaNova') }}
            </p>
            <p v-if="previa.profissional" data-testid="previa-profissional">
              {{
                t('pessoas.admissao.reusarProfissional', {
                  nome: previa.profissional.nome,
                  registros: previa.profissional.registros,
                })
              }}
            </p>
            <template v-for="u in previa.usuarios" :key="u.id">
              <SanteAlerta
                v-if="u.bloqueado"
                :texto="t('pessoas.admissao.usuarioBloqueado', { login: u.login })"
                variante="aviso"
              />
              <p v-else data-testid="previa-usuario">
                {{ t('pessoas.admissao.reusarUsuario', { login: u.login }) }}
              </p>
            </template>
            <p v-if="previa.vinculosAtivos.length">
              {{ t('pessoas.admissao.outrosVinculos', { quantos: previa.vinculosAtivos.length }) }}
            </p>
          </div>
          <div class="acoes">
            <SanteBotao
              :rotulo="t('pessoas.admissao.continuar')"
              :desabilitado="previa.ambigua"
              data-testid="admissao-continuar"
              @acionar="passo = 'vinculo'"
            />
          </div>
        </template>
      </form>

      <form v-else-if="passo === 'vinculo'" class="bloco" @submit.prevent="passo = 'confirmar'">
        <SanteAlerta v-if="!previa" :texto="t('pessoas.admissao.nenhumaPrevia')" variante="info" />
        <div class="campos">
          <SanteCampoTexto
            v-model="nome"
            :rotulo="t('pessoas.admissao.nome')"
            :max-bytes="70"
            obrigatorio
            data-testid="admissao-nome"
          />
          <SanteSelecao
            v-model="tipo"
            :rotulo="t('pessoas.admissao.tipo')"
            :opcoes="opcoesTipo"
            obrigatorio
            data-testid="admissao-tipo"
          />
          <SanteData
            v-model="admissao"
            :rotulo="t('pessoas.admissao.data')"
            editavel
            data-testid="admissao-data"
          />
          <SanteCampoTexto
            v-model="cargo"
            :rotulo="t('pessoas.admissao.cargo')"
            :max-bytes="60"
            obrigatorio
            data-testid="admissao-cargo"
          />
          <SanteCampoTexto
            v-model="funcao"
            :rotulo="t('pessoas.admissao.funcao')"
            :max-bytes="60"
            data-testid="admissao-funcao"
          />
          <SanteCampoTexto
            v-model="carga"
            :rotulo="t('pessoas.admissao.carga')"
            :max-bytes="2"
            obrigatorio
            data-testid="admissao-carga"
          />
          <SanteSelecao
            v-model="centroCusto"
            :rotulo="t('pessoas.admissao.centroCusto')"
            :opcoes="opcoesCentro"
            obrigatorio
            busca
            data-testid="admissao-centro-custo"
          />
          <SanteSelecao
            v-model="unidade"
            :rotulo="t('pessoas.admissao.unidade')"
            :opcoes="opcoesUnidade"
            data-testid="admissao-unidade"
          />
          <SanteCampoTexto
            v-model="setor"
            :rotulo="t('pessoas.admissao.setor')"
            :max-bytes="60"
            data-testid="admissao-setor"
          />
          <SanteCampoTexto
            v-model="matricula"
            :rotulo="t('pessoas.admissao.matricula')"
            :max-bytes="20"
            obrigatorio
            data-testid="admissao-matricula"
          />
        </div>
        <h2 class="secundario">{{ t('pessoas.admissao.fichaTitulo') }}</h2>
        <div class="campos">
          <SanteData
            v-model="nascimento"
            :rotulo="t('pessoas.admissao.nascimento')"
            editavel
            data-testid="admissao-nascimento"
          />
          <SanteSelecao
            v-model="sexo"
            :rotulo="t('pessoas.admissao.sexo')"
            :opcoes="opcoesSexo"
            obrigatorio
            data-testid="admissao-sexo"
          />
          <SanteSelecao
            v-model="grauInstrucao"
            :rotulo="t('pessoas.admissao.grauInstrucao')"
            :opcoes="opcoesGrau"
            obrigatorio
            data-testid="admissao-grau-instrucao"
          />
          <SanteSelecao
            v-model="categoria"
            :rotulo="t('pessoas.admissao.categoria')"
            :opcoes="opcoesCategoria"
            obrigatorio
            busca
            data-testid="admissao-categoria"
          />
          <SanteSelecao
            v-model="tipoVinculoTrabalho"
            :rotulo="t('pessoas.admissao.tipoVinculoTrabalho')"
            :opcoes="opcoesNatureza"
            obrigatorio
            busca
            data-testid="admissao-natureza"
          />
          <SanteCampoTexto
            v-model="salario"
            :rotulo="t('pessoas.admissao.salario')"
            :max-bytes="16"
            obrigatorio
            data-testid="admissao-salario"
          />
        </div>
        <SanteAlerta v-if="fichaErro" :texto="fichaErro" variante="aviso" data-testid="admissao-ficha-erro" />
        <p class="secundario">{{ t('pessoas.admissao.cargaLimite', { limite }) }}</p>
        <SanteAlerta
          v-if="acimaDoLimite"
          :texto="t('pessoas.admissao.cargaLimite', { limite })"
          variante="aviso"
        />
        <ul v-if="camposInvalidos.length" class="secundario">
          <li v-for="m in camposInvalidos" :key="m">{{ m }}</li>
        </ul>
        <div class="acoes">
          <SanteBotao :rotulo="t('pessoas.voltar')" variante="texto" @acionar="passo = 'cpf'" />
          <SanteBotao
            :rotulo="t('pessoas.admissao.continuar')"
            tipo="submit"
            :desabilitado="!entrada.success || acimaDoLimite || !fichaCompleta"
            data-testid="admissao-revisar"
          />
        </div>
      </form>

      <div v-else class="bloco" data-testid="admissao-resumo">
        <p>{{ t('pessoas.admissao.resumo') }}</p>
        <dl class="dados">
          <dt>{{ t('pessoas.admissao.resumoPessoa') }}</dt>
          <dd>{{ nome }}</dd>
          <dt>{{ t('pessoas.admissao.tipo') }}</dt>
          <dd>{{ TIPOS_VINCULO[tipo] }}</dd>
          <dt>{{ t('pessoas.admissao.data') }}</dt>
          <dd>{{ dataBr(admissao) }}</dd>
          <dt>{{ t('pessoas.admissao.cargo') }}</dt>
          <dd>{{ cargo }}</dd>
          <dt>{{ t('pessoas.admissao.carga') }}</dt>
          <dd>{{ carga }}</dd>
          <dt>{{ t('pessoas.admissao.centroCusto') }}</dt>
          <dd>{{ opcoesCentro.find((o) => o.valor === centroCusto)?.rotulo ?? '' }}</dd>
          <dt>{{ t('pessoas.admissao.nascimento') }}</dt>
          <dd>{{ dataBr(nascimento) }}</dd>
          <dt>{{ t('pessoas.admissao.categoria') }}</dt>
          <dd>{{ opcoesCategoria.find((o) => o.valor === categoria)?.rotulo ?? '' }}</dd>
          <dt>{{ t('pessoas.admissao.tipoVinculoTrabalho') }}</dt>
          <dd>{{ opcoesNatureza.find((o) => o.valor === tipoVinculoTrabalho)?.rotulo ?? '' }}</dd>
          <dt>{{ t('pessoas.admissao.salario') }}</dt>
          <dd data-testid="admissao-resumo-salario">{{ salario }}</dd>
        </dl>
        <div class="acoes">
          <SanteBotao :rotulo="t('pessoas.voltar')" variante="texto" @acionar="passo = 'vinculo'" />
          <SanteBotao
            :rotulo="t('pessoas.admissao.titulo')"
            :desabilitado="ocupado"
            data-testid="admissao-gravar"
            @acionar="gravar"
          />
        </div>
      </div>
      <ErroPessoas v-if="erro" :erro="erro" />
    </template>
  </section>
</template>

<style scoped src="../estilo-pessoas.css"></style>
