from app import app
from tests.test_scm_runtime import validate_scm_runtime

if __name__=="__main__":
    print(validate_scm_runtime(app))
